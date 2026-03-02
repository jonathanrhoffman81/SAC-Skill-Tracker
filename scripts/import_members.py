import pandas as pd
import os
from dotenv import load_dotenv
from supabase import create_client
from datetime import datetime

load_dotenv()

# -----------------------------
# CONFIG
# -----------------------------

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
ORG_ID = os.getenv("ORG_ID")



# -----------------------------
# CREATE CLIENT
# -----------------------------

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

print(
    supabase.table("member")
    .select("*")
    .limit(1)
    .execute()
)
# -----------------------------
# LOAD CSV
# -----------------------------

df = pd.read_csv("members.csv")

# -----------------------------
# IMPORT DATA
# -----------------------------

for index, row in df.iterrows():

    try:
        first_name = str(row["Memb. First Name"]).strip()
        last_name = str(row["Memb. Last Name"]).strip()

        gender = None
        if "Gender" in row and pd.notna(row["Gender"]):
            gender = str(row["Gender"]).strip()
            
        # Convert birthday
        birthday = None
        if pd.notna(row["Birthday"]):
            birthday = datetime.strptime(
                row["Birthday"],
                "%m/%d/%Y"
            ).strftime("%Y-%m-%d")

        response = supabase.table("member").insert({
            "organization_id": ORG_ID,
            "first_name": first_name,
            "last_name": last_name,
            "gender": gender,
            "date_of_birth": birthday,
            "level": "1"
        }).execute()

        print(f"Inserted {first_name} {last_name}")

    except Exception as e:
        print(f"Error on row {index}: {e}")

print("Import finished!")