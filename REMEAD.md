# 終端機 1 — 後端 FastAPI（port 8000）
cd c:\github\WordPractice\backend
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload

# 終端機 2 — 前端 React（port 3001）
cd c:\github\WordPractice\frontend\my-app
$env:PORT=3001; npm start