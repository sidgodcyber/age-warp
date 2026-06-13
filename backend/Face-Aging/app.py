import os
import time
import torch
from models import UNet
from test_functions import process_image
from PIL import Image
import gradio as gr
from gradio_client import Client, handle_file
from huggingface_hub import hf_hub_download
import tempfile
from dotenv import load_dotenv

load_dotenv()

from test_compress import build_context, imagine

# Model download & caching directory (created in Dockerfile)
MODEL_DIR = "/tmp/model"
os.makedirs(MODEL_DIR, exist_ok=True)
MODEL_PATH = os.path.join(MODEL_DIR, "best_unet_model.pth")

def download_model():
    print("Starting model download at", time.strftime("%Y-%m-%d %H:%M:%S"))
    path = hf_hub_download(
        repo_id="Robys01/face-aging",
        filename="best_unet_model.pth",
        local_dir=MODEL_DIR,
        cache_dir=os.environ.get("HUGGINGFACE_HUB_CACHE"),
    )
    print(f"Model downloaded to {path}")

if not os.path.exists(MODEL_PATH):
    download_model()

# Load model
model = UNet()  
model.load_state_dict(torch.load(MODEL_PATH, map_location=torch.device("cpu"), weights_only=False))
model.eval()


def age_image(image_path: str, source_age: int, target_age: int, request: gr.Request | None = None) -> Image.Image:
    try:
        context = build_context(request)
        image = Image.open(image_path)
        if image.mode not in ["RGB", "L"]:
            print(f"Converting image from {image.mode} to RGB")
            image = image.convert("RGB")
        processed_image = process_image(model, image, source_age, target_age)
        imagine(image_path, source_age, context=context) 
        return processed_image
    except ValueError as e:
        if "No faces detected" in str(e):
            raise gr.Error("No faces detected in the image. Please upload an image with a clear, visible face.")
        else:
            raise gr.Error(f"Error processing image: {str(e)}")
    except Exception as e:
        raise gr.Error(f"Unexpected error: {str(e)}")


def age_video(image_path: str, source_age: int, target_age: int, duration: int, fps: int, request: gr.Request | None = None) -> str:
    try:
        context = build_context(request)
        image = Image.open(image_path)

        orig_tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        orig_path = orig_tmp.name
        image.save(orig_path)
        orig_tmp.close()

        aged_img = age_image(image_path, source_age, target_age, request=request)
        aged_tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        aged_path = aged_tmp.name
        aged_img.save(aged_path)
        aged_tmp.close()
        imagine(image_path, source_age, context=context)

        client = Client("Robys01/Face-Morphing")
        try:
            result = client.predict(
                image_files=[handle_file(orig_path), handle_file(aged_path)],
                duration=duration,
                fps=fps,
                method="Dlib",
                align_resize=False,
                order_images=False,
                guideline=False,
                api_name="/predict"
            )
        except Exception as e:
            raise gr.Error(f"Error during video generation: {e}")
       
         # Unpack response for video path
        video_path = None
        # handle (data, msg) tuple
        if isinstance(result, tuple):
            data, msg = result
            video_path = data.get('video') if isinstance(data, dict) else None
            print(f"Response message: {msg}")

        if not video_path or not os.path.exists(video_path):
            raise gr.Error(f"Video file not found: {video_path}")

        return video_path
    except gr.Error:
        # Re-raise Gradio errors as-is
        raise
    except Exception as e:
        raise gr.Error(f"Unexpected error in video generation: {str(e)}")


def age_timelapse(image_path: str, source_age: int, request: gr.Request | None = None) -> str:
    try:
        context = build_context(request)
        image = Image.open(image_path)

        target_ages = [10, 20, 30, 50, 70]
        # Filter out ages too close to source
        filtered = [age for age in target_ages if abs(age - source_age) >= 4]
        # Combine with source and sort
        ages = sorted(set(filtered + [source_age]))
        temp_handles = []

        for age in ages:
            if age == source_age:
                img = image
            else:
                img = age_image(image_path, source_age, age, request=request)
            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            path = tmp.name
            img.save(path)
            tmp.close()
            temp_handles.append(handle_file(path))
        imagine(image_path, source_age, context=context)

        client = Client("Robys01/Face-Morphing")
        try:
            result = client.predict(
                image_files=temp_handles,
                duration=3,
                fps=20,
                method="Dlib",
                align_resize=False,
                order_images=False,
                guideline=False,
                api_name="/predict"
            )
        except Exception as e:
            raise gr.Error(f"Error generating timelapse video: {e}")

        video_path = None
        if isinstance(result, tuple):
            data, msg = result
            video_path = data.get('video') if isinstance(data, dict) else None
            print(f"Response message: {msg}")

        if not video_path or not os.path.exists(video_path):
            raise gr.Error(f"Timelapse video not found: {video_path}")
        return video_path
    except gr.Error:
        # Re-raise Gradio errors as-is
        raise
    except Exception as e:
        raise gr.Error(f"Unexpected error in timelapse generation: {str(e)}")


demo_age_image = gr.Interface(
    fn=age_image,
    inputs=[
        gr.Image(type="filepath", label="Input Image"),
        gr.Slider(0, 90, value=20, step=1, label="Current age", info="Choose the current age"),
        gr.Slider(0, 90, value=70, step=1, label="Target age", info="Choose the desired age")
    ],
    outputs=gr.Image(type="pil", label="Aged Image"),
    examples=[
        ["examples/girl.jpg", 14, 50],
        ["examples/man.jpg", 45, 70],
        ["examples/man.jpg", 45, 20],
        ["examples/trump.jpg", 74, 30],
    ],
    cache_examples=True,
    description="Upload an image along with a source age approximation and a target age to generate an aged version of the face."
)

demo_age_video = gr.Interface(
    fn=age_video,
    inputs=[
        gr.Image(type="filepath", label="Input Image"),
        gr.Slider(0, 90, value=20, step=1, label="Current age", info="Choose the current age"),
        gr.Slider(0, 90, value=70, step=1, label="Target age", info="Choose the desired age"),
        gr.Slider(label="Duration (seconds)", minimum=1, maximum=10, step=1, value=3),
        gr.Slider(label="Frames per second (fps)", minimum=2, maximum=60, step=1, value=30),    
    ],
    outputs=gr.Video(label="Aged Video", format="mp4"),

    examples=[
        ["examples/girl.jpg", 14, 50, 3, 30],
        ["examples/man.jpg", 45, 70, 3, 30],
        ["examples/man.jpg", 45, 20, 3, 30],
    ],
    cache_examples=True,
    description="Generate a video of the aging process."
)

demo_age_timelapse = gr.Interface(
    fn=age_timelapse,
    inputs=[gr.Image(type="filepath", label="Input Image"), gr.Slider(0, 90, value=20, step=1, label="Current age")],
    outputs=[gr.Video(label="Aging Timelapse", format="mp4")],
    examples=[
        ["examples/girl.jpg", 14],
        ["examples/man.jpg", 45],
    ],
    cache_examples=True,
    description="Generate a timelapse video showing the aging process at different ages."
)


if __name__ == "__main__":

    iface = gr.TabbedInterface(
        [demo_age_image, demo_age_video, demo_age_timelapse],
        tab_names=["Face Aging", "Aging Video", "Aging Timelapse"],
        title="Face Aging Demo",
    ).queue()
    iface.launch(server_name="0.0.0.0", server_port=7000)
