import os
from pathlib import Path
from dotenv import load_dotenv
from google import genai

load_dotenv()
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
img = client.files.upload(file=Path(__file__).parent / "test_meal.jpg")
r = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=[img, "List the foods in this photo with estimated grams, as JSON."],
)
print(r.text)
