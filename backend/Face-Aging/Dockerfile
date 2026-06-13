# Stage 1: Builder
FROM python:3.12 AS builder

WORKDIR /app

RUN pip install --upgrade pip setuptools wheel

RUN pip install cmake

# Install system build dependencies
RUN apt-get clean && apt-get -y update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        libopenblas-dev \
        liblapack-dev \
        libx11-dev \
        libpng-dev \
        libjpeg-dev \
        libtiff-dev && \
    rm -rf /var/lib/apt/lists/*

ENV CMAKE_BUILD_PARALLEL_LEVEL=4

RUN python -m venv venv
ENV VIRTUAL_ENV=/app/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Stage 2: Runner
FROM python:3.12-slim AS runner

WORKDIR /app

# Install runtime dependency: libopenblas.so.0 is provided by libopenblas-base.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libopenblas0 \
        liblapack3 \
        libx11-6 \
        libpng16-16 \
        libjpeg62-turbo \
        libtiff6 && \
    rm -rf /var/lib/apt/lists/*

ENV HF_HOME=/tmp/huggingface
ENV HUGGINGFACE_HUB_CACHE=/tmp/huggingface
ENV XDG_CACHE_HOME=/tmp/.cache
ENV GRADIO_CACHE_DIR=/tmp/.gradio
ENV GRADIO_EXAMPLES_CACHE=/tmp/.gradio/cached_examples
ENV PYTHONUNBUFFERED=1

RUN mkdir -p /tmp/model /tmp/huggingface /tmp/.cache /tmp/.gradio /tmp/.gradio/cached_examples \
    && chmod -R 777 /tmp/model /tmp/huggingface /tmp/.cache /tmp/.gradio /tmp/.gradio/cached_examples

COPY --from=builder /app/venv venv

COPY app.py models.py test_functions.py test_compress.py ./
COPY examples/ /app/examples/
COPY assets/ /app/assets/

ENV VIRTUAL_ENV=/app/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

EXPOSE 7000

CMD ["python", "app.py"]
