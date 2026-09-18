"""Populate the RapidOCR cache included in the worker's models.zip archive."""

import argparse
from pathlib import Path

from rapidocr.inference_engine.base import FileInfo, InferSession
from rapidocr.utils.download_file import DownloadFile, DownloadFileInput
from rapidocr.utils.download_models import download_single_file
from rapidocr.utils.log import logger
from rapidocr.utils.parse_parameters import ParseParams


DEFAULT_CONFIG = (
    Path(__file__).resolve().parents[1]
    / "packages/worker/rapidocr/rapidocr-config.yaml"
)


def download_model(output_dir: Path, info) -> None:
    download_single_file(output_dir, info)
    path = output_dir / Path(info["model_dir"]).name
    if not DownloadFile.check_file_sha256(path, info["SHA256"]):
        raise ValueError(f"Checksum mismatch: {path}")


def download_models(config_path: Path, output_dir: Path) -> None:
    cfg = ParseParams.load(config_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Detection and classification are shared by every recognition language.
    for section in (cfg.Det, cfg.Cls):
        info = InferSession.get_model_url(
            FileInfo(
                section.engine_type,
                section.ocr_version,
                section.task_type,
                section.lang_type,
                section.model_type,
            )
        )
        download_model(output_dir, info)

    # The plugin replaces Rec.lang_type for each job. Download every recognizer
    # of the configured version/size, not just the YAML's default Chinese model.
    recognizers = InferSession.model_info[cfg.Rec.engine_type.value][
        cfg.Rec.ocr_version.value
    ].rec
    selected = {
        name: info
        for name, info in recognizers.items()
        if name.endswith(f"_rec_{cfg.Rec.model_type.value}")
    }
    if not selected:
        raise ValueError("No recognition models match the worker configuration")
    for name, info in selected.items():
        print(f"Downloading {name}", flush=True)
        download_model(output_dir, info)

    # Explicit font_path avoids RapidOCR falling back to its package-local font
    # cache. The worker extracts text/hOCR and does not render OCR visualizations.
    font = InferSession.model_info.fonts.ch
    DownloadFile.run(
        DownloadFileInput(
            file_url=font.path,
            save_path=output_dir / "FZYTK.TTF",
            sha256=font.SHA256,
            logger=logger,
        )
    )
    if not DownloadFile.check_file_sha256(output_dir / "FZYTK.TTF", font.SHA256):
        raise ValueError("Checksum mismatch: FZYTK.TTF")
    print(f"RapidOCR cache ready at {output_dir.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output-dir", type=Path, default=Path("models/rapidocr"))
    args = parser.parse_args()
    download_models(args.config, args.output_dir)
