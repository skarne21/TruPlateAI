import os
import requests
from dotenv import load_dotenv

load_dotenv()
r = requests.get(
    "https://api.nal.usda.gov/fdc/v1/foods/search",
    params={"api_key": os.environ["USDA_API_KEY"], "query": "idli", "pageSize": 3},
)
for f in r.json()["foods"]:
    print(
        f["description"],
        {n["nutrientName"]: n["value"] for n in f["foodNutrients"] if n["nutrientName"] in ("Energy", "Protein")},
    )
