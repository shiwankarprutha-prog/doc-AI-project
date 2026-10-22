@echo off
echo Installing dependencies...
pip install -r requirements.txt
echo.
echo Running migrations...
python manage.py makemigrations assistant
python manage.py migrate
echo.
echo Starting server on http://localhost:8000
python manage.py runserver 0.0.0.0:8000
