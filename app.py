from flask import Flask, request, jsonify, render_template, send_from_directory
from crack_model import run_simulation, compare_materials, MATERIALS, compute_validation, run_monte_carlo
import os

app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static'),
        filename
    )

def _validate(data, require_stress=True):
    crack   = float(data["initial_crack"])
    flights = float(data["flights_per_day"])
    stress  = float(data["stress"]) if require_stress else 0
    if require_stress and (stress <= 0 or stress > 600): raise ValueError("Stress must be 1–600 MPa.")
    if crack   <= 0:  raise ValueError("Crack must be > 0.")
    if flights <= 0:  raise ValueError("Flights per day must be > 0.")
    return stress, crack, flights

@app.route("/simulate", methods=["POST"])
def simulate():
    try:
        data     = request.get_json()
        material = data.get("material")
        if material not in MATERIALS:
            return jsonify({"error": "Invalid material."}), 400
        stress, crack, flights = _validate(data)
        result = run_simulation(material, stress, crack, flights)
        if "error" in result:
            return jsonify(result), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/compare", methods=["POST"])
def compare():
    try:
        data = request.get_json()
        stress, crack, flights = _validate(data)
        results = compare_materials(stress, crack, flights)
        for mat, res in results.items():
            if "error" in res:
                return jsonify({"error": f"{mat}: {res['error']}"}), 400
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/sensitivity", methods=["POST"])
def sensitivity():
    try:
        data = request.get_json()
        _, crack, flights = _validate(data, require_stress=False)
        stresses = list(range(80, 260, 10))
        results  = {}
        for mat in MATERIALS:
            rows = []
            for s in stresses:
                r = run_simulation(mat, s, crack, flights)
                if "error" not in r:
                    rows.append({
                        "stress":             s,
                        "cycles":             r["cycles"],
                        "safe_cycles":        r["safe_cycles"],
                        "years":              r["years"],
                        "inspection_cycles":  r["inspection_cycles"],
                        "inspection_years":   r["inspection_years"],
                        "critical_length_mm": r["critical_length_mm"],
                        "yield_warning":      r["yield_warning"],
                        "status":             r["status"],
                    })
            results[mat] = rows
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/validation", methods=["GET"])
def validation():
    try:
        return jsonify(compute_validation())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/monte_carlo", methods=["POST"])
def monte_carlo():
    try:
        data = request.get_json()
        material = data.get("material")
        if material not in MATERIALS:
            return jsonify({"error": "Invalid material."}), 400
        stress, crack, flights = _validate(data)
        result = run_monte_carlo(material, stress, crack, flights)
        if "error" in result:
            return jsonify(result), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True)