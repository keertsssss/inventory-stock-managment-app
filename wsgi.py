"""
WSGI Entry Point for PythonAnywhere and Production Servers
"""
import sys
import os

# Ensure the project directory is at the root of sys.path
project_dir = os.path.dirname(os.path.abspath(__file__))
if project_dir not in sys.path:
    sys.path.insert(0, project_dir)

from app import application

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    application.run(host="0.0.0.0", port=port)
