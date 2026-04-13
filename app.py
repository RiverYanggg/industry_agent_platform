import datetime as dt
import os

import gradio as gr


def greet(name: str) -> str:
    """Simple starter handler for Space validation."""
    safe_name = (name or "").strip() or "Industry Agent"
    return f"Hello, {safe_name}! Gradio hosting is ready."


def get_runtime_info() -> str:
    now = dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    return (
        "Industry Agent Platform Space is online.\n"
        f"- Timestamp: {now}\n"
        f"- Python env: {os.environ.get('PYTHON_VERSION', 'default')}"
    )


with gr.Blocks(title="Industry Agent Platform") as demo:
    gr.Markdown(
        """
        # Industry Agent Platform (Gradio Space)
        This is the Gradio entrypoint for hosted deployment.
        """
    )
    with gr.Tab("Quick Check"):
        name_input = gr.Textbox(label="Your name", placeholder="Type your name")
        greet_output = gr.Textbox(label="Response")
        greet_btn = gr.Button("Run")
        greet_btn.click(fn=greet, inputs=name_input, outputs=greet_output)

    with gr.Tab("Runtime"):
        runtime_box = gr.Textbox(label="Runtime info", lines=6)
        refresh_btn = gr.Button("Refresh")
        refresh_btn.click(fn=get_runtime_info, outputs=runtime_box)


if __name__ == "__main__":
    demo.launch()
