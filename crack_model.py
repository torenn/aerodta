"""
crack_model.py — AeroDTA
==============================
Fatigue crack growth simulation using Paris Law (LEFM).

Physics:
    Δσ = σ_max × (1 - R)                     effective stress range
    ΔK = Y(a) × Δσ × √(π × a)               stress intensity factor range
    da/dN = C × (ΔK)^m                        Paris Law crack growth rate
    a_c = (K_IC / (Y × σ_max))² / π          critical crack length (iterative)

Geometry factor — rivet hole model:
    s = a / (R_hole + a)
    Y(a) = 0.5 × (3-s) × [1 + 1.243×(1-s)³]
    Limits: Y→3.36 as a→0,  Y≈1.44 at a=R_hole,  Y→1.12 as a→∞

Constants (validated against Hudson 1969, NASA TN D-5390):
    AA2024-T3: C=1.44e-10, m=2.60,  K_IC=36.5 MPa√m, σ_y=332.0 MPa
    AA7075-T6: C=5.27e-10, m=2.947, K_IC=29.1 MPa√m, σ_y=469.0 MPa
"""

import numpy as np

MATERIALS = {
    "2024-T3": {
        "C": 1.44e-10, "m": 2.60, "K_IC": 36.5, "sigma_y": 332.0, "COV": 0.07,
        "name": "Aluminum 2024-T3", "use": "Fuselage skin"
    },
    "7075-T6": {
        "C": 5.27e-10, "m": 2.947, "K_IC": 29.1, "sigma_y": 469.0, "COV": 0.04,
        "name": "Aluminum 7075-T6", "use": "High-strength structural"
    }
}

# ── NASA validation data ──────────────────────────────────────────────────
# Forth, Wright & Johnston (2005), NASA/TM-2005-213907,
# "7075-T6 and 2024-T351 Aluminum Alloy Fatigue Crack Growth Rate Data"
# R = 0.1, room temperature, lab air. Structured as a list per material so
# more specimens/rows can be appended later without changing the shape.
NASA_VALIDATION_DATA = {
    "7075-T6": {
        "specimen": "AL-7-21",
        "source":   "Forth et al. (2005), NASA/TM-2005-213907, Table A1",
        "delta_K":  [11.52, 11.73, 11.96, 12.20, 12.46, 12.73, 12.99],
        "da_dN":    [4.29e-7, 4.49e-7, 4.75e-7, 4.97e-7, 5.17e-7, 5.37e-7, 5.56e-7],
    },
    "2024-T351": {
        "specimen": "AL-2-26",
        "source":   "Forth et al. (2005), NASA/TM-2005-213907, Table A4",
        "delta_K":  [10.20, 10.37, 10.56, 10.75, 10.95],
        "da_dN":    [1.43e-7, 1.63e-7, 1.79e-7, 1.89e-7, 1.96e-7],
    },
}
# Maps a NASA specimen's alloy label to the MATERIALS key whose Paris
# constants it should be checked against. 2024-T351 is a different temper
# from 2024-T3 (different quench/age history -> slightly different C, m in
# general); it's the closest published NASA dataset available for comparison.
NASA_TO_MODEL_MATERIAL = {
    "7075-T6":   "7075-T6",
    "2024-T351": "2024-T3",
}

R             = 0.1       # Stress ratio (GAG cycle)
R_HOLE        = 2.45e-3   # Rivet hole radius (m)
SAFETY_FACTOR = 2.0
PLOT_POINTS   = 300       # points to collect for chart


def geometry_factor(a):
    """Y(a) for crack from rivet hole. a in meters."""
    s = a / (R_HOLE + a)
    return 0.5 * (3.0 - s) * (1.0 + 1.243 * (1.0 - s) ** 3)


def critical_crack_length(K_IC, sigma_max):
    """Iteratively solve a_c = (K_IC/(Y×σ))²/π since Y depends on a."""
    a = (1.0 / np.pi) * (K_IC / (1.12 * sigma_max)) ** 2
    for _ in range(50):
        Y   = geometry_factor(a)
        a_n = (1.0 / np.pi) * (K_IC / (Y * sigma_max)) ** 2
        if abs(a_n - a) < 1e-10:
            break
        a = a_n
    return a


def stress_category(sigma_max, sigma_y):
    if sigma_max > sigma_y:
        return (f"WARNING: {sigma_max} MPa exceeds yield strength ({sigma_y} MPa). "
                "Structural failure imminent.", True)
    elif sigma_max <= 150:
        return "Normal Operating Range (Fuselage/Skin): 80–150 MPa", False
    elif sigma_max <= 250:
        return "High Load Range (Joints/Manoeuvres): 151–250 MPa", False
    else:
        return "Extreme Load Range: > 250 MPa", False


def run_simulation(material, stress, initial_crack, flights_per_day):
    """
    Full simulation from a0 to a_crit.
    Returns dict with all outputs, or dict with 'error' key.
    """
    if material not in MATERIALS:
        return {"error": f"Unknown material '{material}'."}

    props   = MATERIALS[material]
    C, m, K_IC, sigma_y = props["C"], props["m"], props["K_IC"], props["sigma_y"]

    cat, is_yield = stress_category(stress, sigma_y)

    delta_sigma = stress * (1.0 - R)
    a_crit      = critical_crack_length(K_IC, stress)
    a0          = initial_crack

    if a0 >= a_crit:
        return {"error": (
            f"Initial crack ({a0*1000:.2f} mm) ≥ critical length "
            f"({a_crit*1000:.2f} mm) at σ = {stress} MPa."
        )}

    # ── Simulation ───────────────────────────────────────────────────────────
    a      = a0
    cycles = 0
    total_distance = a_crit - a0

    # Collect exactly PLOT_POINTS evenly spaced by crack distance
    sample_dist  = total_distance / PLOT_POINTS
    next_sample  = a0 + sample_dist

    crack_list  = [round(a * 1000, 5)]
    cycle_list  = [0]
    paris_list  = []   # {delta_K, da_dN} for Paris plot

    while a < a_crit:
        Y      = geometry_factor(a)
        dK     = Y * delta_sigma * np.sqrt(np.pi * a)
        da_dN  = C * (dK ** m)

        if da_dN <= 0:
            break

        # Adaptive step: advance 0.1% of remaining distance
        remaining = a_crit - a
        step_dist = max(da_dN, remaining * 0.001)
        n         = max(1, int(step_dist / da_dN))
        n         = min(n, int(remaining / da_dN) + 1)  # don't overshoot

        a      += da_dN * n
        cycles += n

        # Sample for crack growth chart (distance-based)
        if a >= next_sample:
            crack_list.append(round(min(a, a_crit) * 1000, 5))
            cycle_list.append(int(cycles))
            next_sample = min(a + sample_dist, a_crit)

        # Sample for Paris plot (sparse)
        if len(paris_list) < 150 and len(paris_list) < cycles / max(1, cycles // 150):
            paris_list.append({"delta_K": round(dK, 4), "da_dN": float(f"{da_dN:.4e}")})

    # Ensure final point
    if crack_list[-1] < a_crit * 1000 * 0.999:
        crack_list.append(round(a_crit * 1000, 5))
        cycle_list.append(int(cycles))

    # ── Post-processing ──────────────────────────────────────────────────────
    years_raw         = cycles / (flights_per_day * 365)
    years_safe        = years_raw / SAFETY_FACTOR
    safe_cycles       = int(cycles / SAFETY_FACTOR)
    inspection_cycles = int(cycles / 3)
    inspection_years  = inspection_cycles / (flights_per_day * 365)

    # Status based on safe life (not raw crack ratio which always ends at 1.0)
    if is_yield:
        status, message = "CRITICAL", "Stress exceeds yield strength. Do not operate."
    elif years_safe < 2:
        status, message = "CRITICAL", "Safe life under 2 years. Immediate structural review required."
    elif years_safe < 10:
        status, message = "DANGEROUS", "Safe life under 10 years. Schedule inspection urgently."
    else:
        status, message = "OK", "Structure within safe operating limits."

    return {
        "material":            props["name"],
        "material_key":        material,
        "stress_max":          stress,
        "stress_ratio":        R,
        "delta_sigma":         round(delta_sigma, 2),
        "initial_crack_mm":    round(a0 * 1000, 3),
        "flights_per_day":     flights_per_day,
        "K_IC":                K_IC,
        "sigma_y":             sigma_y,
        "Y_initial":           round(geometry_factor(a0), 4),
        "Y_final":             round(geometry_factor(min(a, a_crit)), 4),
        "critical_length_mm":  round(a_crit * 1000, 3),
        "final_crack_mm":      round(min(a, a_crit) * 1000, 3),
        "rivet_hole_mm":       round(R_HOLE * 1000, 2),
        "cycles":              int(cycles),
        "safe_cycles":         safe_cycles,
        "inspection_cycles":   inspection_cycles,
        "years_raw":           round(years_raw, 2),
        "years":               round(years_safe, 2),
        "inspection_years":    round(inspection_years, 2),
        "safety_factor":       SAFETY_FACTOR,
        "status":              status,
        "status_message":      message,
        "stress_category":     cat,
        "yield_warning":       is_yield,
        "crack_list":          crack_list,
        "cycle_list":          cycle_list,
        "paris_plot":          paris_list,
    }


def compare_materials(stress, initial_crack, flights_per_day):
    return {mat: run_simulation(mat, stress, initial_crack, flights_per_day)
            for mat in MATERIALS}


def compute_validation(n_points=50, dk_min=8.0, dk_max=35.0):
    """
    Builds the da/dN vs ΔK validation package: smooth Paris-law model
    curves for each material plus the NASA experimental points, and a
    summary of how closely the model tracks the NASA data.
    Does not touch MATERIALS or the geometry factor — read-only comparison.
    """
    step = (dk_max - dk_min) / (n_points - 1)
    dk_range = [dk_min + i * step for i in range(n_points)]

    model_curves = {}
    for mat, props in MATERIALS.items():
        C, m = props["C"], props["m"]
        model_curves[mat] = {
            "delta_K": [round(dk, 4) for dk in dk_range],
            "da_dN":   [float(f"{C * (dk ** m):.4e}") for dk in dk_range],
        }

    nasa_points = {}
    validation_summary = {}
    for nasa_mat, data in NASA_VALIDATION_DATA.items():
        model_mat = NASA_TO_MODEL_MATERIAL[nasa_mat]
        C, m = MATERIALS[model_mat]["C"], MATERIALS[model_mat]["m"]

        nasa_points[nasa_mat] = {
            "delta_K": data["delta_K"],
            "da_dN":   data["da_dN"],
        }

        ratios, within_2x = [], 0
        for dk, da_nasa in zip(data["delta_K"], data["da_dN"]):
            da_model = C * (dk ** m)
            ratio = da_model / da_nasa
            ratios.append(ratio)
            if 0.5 <= ratio <= 2.0:
                within_2x += 1

        validation_summary[nasa_mat] = {
            "model_material":            model_mat,
            "specimen":                  data["specimen"],
            "source":                    data["source"],
            "n_points":                  len(ratios),
            "mean_model_to_nasa_ratio":  round(sum(ratios) / len(ratios), 3),
            "pct_within_factor_2":       round(100 * within_2x / len(ratios), 1),
        }

    return {
        "model_curves":       model_curves,
        "nasa_points":        nasa_points,
        "validation_summary": validation_summary,
    }


# ══════════════════════════════════════════════════════════════════════════
#  MONTE CARLO — probabilistic life assessment
# ══════════════════════════════════════════════════════════════════════════

def run_monte_carlo(material, stress, initial_crack, flights_per_day, n_runs=500):
    """
    Samples the Paris coefficient C from a log-normal distribution
    (COV per Bogdanov 2014) and runs n_runs crack growth simulations.
    Returns distribution statistics and histogram bins.

    Self-contained — does not modify or depend on run_simulation.
    """
    if material not in MATERIALS:
        return {"error": f"Unknown material '{material}'."}

    props   = MATERIALS[material]
    C_mean  = props["C"]
    m       = props["m"]
    K_IC    = props["K_IC"]
    COV     = props["COV"]

    # Log-normal parameters from mean and coefficient of variation
    sigma_ln = np.sqrt(np.log(1 + COV ** 2))
    mu_ln    = np.log(C_mean) - 0.5 * sigma_ln ** 2

    delta_sigma = stress * (1.0 - R)
    a_crit      = critical_crack_length(K_IC, stress)

    if initial_crack >= a_crit:
        return {"error": (
            f"Initial crack ({initial_crack*1000:.2f} mm) ≥ critical length "
            f"({a_crit*1000:.2f} mm) at σ = {stress} MPa."
        )}

    np.random.seed(42)
    lives = []

    for _ in range(n_runs):
        C_sample = np.random.lognormal(mean=mu_ln, sigma=sigma_ln)
        a        = initial_crack
        cycles   = 0
        guard    = 0

        while a < a_crit and guard < 100_000:
            Y     = geometry_factor(a)
            dK    = Y * delta_sigma * np.sqrt(np.pi * a)
            da_dN = C_sample * (dK ** m)
            if da_dN <= 0:
                break
            # Step by 2% of current crack length — fast, accurate enough for MC
            step_dist = max(da_dN, a * 0.02)
            n         = max(1, int(step_dist / da_dN))
            remaining = a_crit - a
            n         = min(n, int(remaining / da_dN) + 1)
            a      += da_dN * n
            cycles += n
            guard  += 1

        lives.append(cycles)

    lives = np.array(lives, dtype=float)
    lives = lives[lives > 0]
    if len(lives) == 0:
        return {"error": "All Monte Carlo runs failed. Check inputs."}

    mean_life   = float(np.mean(lives))
    median_life = float(np.median(lives))
    p5_life     = float(np.percentile(lives, 5))
    std_life    = float(np.std(lives))

    counts, edges = np.histogram(lives, bins=30)
    histogram = [
        {
            "bin_start": float(edges[i]),
            "bin_end":   float(edges[i + 1]),
            "bin_mid":   float((edges[i] + edges[i + 1]) / 2),
            "count":     int(counts[i]),
        }
        for i in range(len(counts))
    ]

    return {
        "material":         props["name"],
        "material_key":     material,
        "stress_max":       stress,
        "initial_crack_mm": round(initial_crack * 1000, 3),
        "n_runs":           int(len(lives)),
        "mean":             mean_life,
        "median":           median_life,
        "p5":               p5_life,
        "std":              std_life,
        "cov_input":        COV,
        "lives":            lives.tolist(),
        "histogram":        histogram,
    }