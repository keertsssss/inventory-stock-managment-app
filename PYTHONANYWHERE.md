# Hosting Your Stock App on PythonAnywhere

Your project is now 100% compatible with **PythonAnywhere**! Follow this simple, step-by-step guide to get your application live with a free permanent URL (e.g. `https://yourusername.pythonanywhere.com`).

---

### Step 1: Create a Free Account
1. Go to [https://www.pythonanywhere.com](https://www.pythonanywhere.com).
2. Click **Pricing & signup** and choose the **Create a Beginner account** (100% Free).
3. Choose your username (e.g., `srinivasa-stock` or your name). Your web link will be `https://<username>.pythonanywhere.com`.

---

### Step 2: Clone Your Repository in PythonAnywhere
1. From your PythonAnywhere dashboard, click on **Consoles** tab.
2. Under **Start a new console**, click **Bash**.
3. In the black terminal that opens, run these 3 commands:
   ```bash
   git clone https://github.com/keertsssss/inventory-stock-managment-app.git
   cd inventory-stock-managment-app
   pip install -r requirements.txt
   ```
   *(Wait ~30 seconds for the installation to finish)*.

---

### Step 3: Set Up the Web App
1. Go back to your PythonAnywhere dashboard and click on the **Web** tab at the top.
2. Click **Add a new web app**.
3. Click **Next** on your domain name (`<username>.pythonanywhere.com`).
4. Select **Manual configuration (not an automated template)**.
5. Select **Python 3.10** (or **Python 3.11**), then click **Next** and wait for it to finish.

---

### Step 4: Configure Source Code & WSGI

On your **Web** configuration page:

1. **Source code**:
   Set to: `/home/<username>/inventory-stock-managment-app`
   *(Replace `<username>` with your actual PythonAnywhere username)*

2. **Working directory**:
   Set to: `/home/<username>/inventory-stock-managment-app`

3. **WSGI configuration file**:
   - Click on the blue link (it looks like `/var/www/<username>_pythonanywhere_com_wsgi.py`).
   - A text editor will open. **Delete all the text inside** and replace it with:
   ```python
   import sys
   import os

   project_home = '/home/<username>/inventory-stock-managment-app'
   if project_home not in sys.path:
       sys.path.insert(0, project_home)

   from app import application
   ```
   *(Make sure to change `<username>` to your PythonAnywhere username)*.
   - Click the green **Save** button at the top right.

---

### Step 5: Reload & Go Live!
1. Go back to the **Web** tab.
2. Click the big green button: **"Reload <username>.pythonanywhere.com"**.
3. Visit your live site at: **`https://<username>.pythonanywhere.com`**!

---

### ✨ Benefits on PythonAnywhere
- **Always Online 24/7**: Does not need your laptop to be turned on or awake.
- **Persistent SQLite Database**: All Tally counts, issue/receive movements, and onboarded items are permanently stored in `data/stock.db`.
- **Photo Uploads**: Any photo snapped on a mobile phone saves directly to the cloud filesystem in `data/uploads/` with 0 laptop disk usage.
- **Free HTTPS**: Comes with a free SSL certificate (`https://`).
