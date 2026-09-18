"""Check every packaged recognizer without allowing network access."""

import argparse
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw
from rapidocr import RapidOCR
from rapidocr.inference_engine.base import InferSession
from rapidocr.utils.parse_parameters import ParseParams

from download_rapidocr_models import DEFAULT_CONFIG


def verify_offline(config_path: Path, models_dir: Path) -> None:
    cfg = ParseParams.load(config_path)
    models_dir = models_dir.resolve()
    image = Image.new("RGB", (320, 64), "white")
    ImageDraw.Draw(image).text((10, 20), "Offline OCR test", fill="black")
    recognizers = InferSession.model_info[cfg.Rec.engine_type.value][
        cfg.Rec.ocr_version.value
    ].rec

    with (
        patch("socket.socket.connect", side_effect=AssertionError("Network access")),
        patch("requests.sessions.Session.request", side_effect=AssertionError("HTTP request")),
    ):
        for name in recognizers:
            if not name.endswith(f"_rec_{cfg.Rec.model_type.value}"):
                continue
            engine = RapidOCR(
                config_path=str(config_path),
                params={
                    "Global.model_root_dir": str(models_dir),
                    "Rec.lang_type": name.split("_PP-OCR")[0],
                    "EngineConfig.onnxruntime.intra_op_num_threads": 1,
                    "EngineConfig.onnxruntime.inter_op_num_threads": 1,
                },
            )
            # Exercise recognition even if the detector finds no text in the
            # synthetic image. Initialization also loads detector/classifier.
            engine(np.asarray(image), use_det=False)
            assert Path(engine.cfg.Global.font_path).is_file()
            print(f"Offline check passed: {name}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--models-dir", type=Path, required=True)
    args = parser.parse_args()
    verify_offline(args.config, args.models_dir)
