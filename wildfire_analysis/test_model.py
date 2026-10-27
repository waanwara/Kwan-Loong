import json
from pathlib import Path

from wildfire_analysis.fire_propagation import simulate_fire


def main():
    current_dir = Path(__file__).resolve().parent
    input_path = current_dir / "sample_input.json"
    output_path = current_dir / "sample_output.json"

    print(f"Reading input from: {input_path}")
    with open(input_path, "r", encoding="utf-8") as f:
        input_data = json.load(f)

    print("Running wildfire propagation model...")
    result = simulate_fire(input_data)

    print(f"Saving output to: {output_path}")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print("\nSimulation completed successfully.")
    print(f"   Rate of spread: {result['summary']['rate_of_spread_m_min']} m/min")
    print(f"   Heading direction: {result['summary']['spread_direction_deg']} deg")
    print(f"   Prediction intervals: {list(result['predictions'].keys())}")


if __name__ == "__main__":
    main()
