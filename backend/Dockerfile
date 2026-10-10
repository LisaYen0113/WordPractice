FROM python:3.12-slim

WORKDIR /app

# 先複製 requirements 再安裝:依賴層能被快取,改程式碼不必重裝依賴
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# 單一 worker:限流計數器在 process 記憶體,多 worker 會各自計數而失準
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
