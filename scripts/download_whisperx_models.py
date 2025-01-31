# This script is used in the amigo whisperx role - see https://github.com/guardian/amigo/pull/1607 - it enables running
# whisperx offline, by pre-downloading all the required models to the AMI. It exists in this repo so that we can make
# changes as new models are released without having to modify amigo itself

import torchaudio
from pyannote.audio import Pipeline
import sys
import huggingface_hub
import typer

# ASR Models
# Should be kept in sync with https://github.com/m-bain/whisperX/blob/main/whisperx/asr.py
DEFAULT_ALIGN_MODELS_TORCH = {
    "en": "WAV2VEC2_ASR_BASE_960H",
    "fr": "VOXPOPULI_ASR_BASE_10K_FR",
    "de": "VOXPOPULI_ASR_BASE_10K_DE",
    "es": "VOXPOPULI_ASR_BASE_10K_ES",
    "it": "VOXPOPULI_ASR_BASE_10K_IT",
}

DEFAULT_ALIGN_MODELS_HF = {
    "ja": "jonatasgrosman/wav2vec2-large-xlsr-53-japanese",
    "zh": "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn",
    "nl": "jonatasgrosman/wav2vec2-large-xlsr-53-dutch",
    "uk": "Yehor/wav2vec2-xls-r-300m-uk-with-small-lm",
    "pt": "jonatasgrosman/wav2vec2-large-xlsr-53-portuguese",
    "ar": "jonatasgrosman/wav2vec2-large-xlsr-53-arabic",
    "cs": "comodoro/wav2vec2-xls-r-300m-cs-250",
    "ru": "jonatasgrosman/wav2vec2-large-xlsr-53-russian",
    "pl": "jonatasgrosman/wav2vec2-large-xlsr-53-polish",
    "hu": "jonatasgrosman/wav2vec2-large-xlsr-53-hungarian",
    "fi": "jonatasgrosman/wav2vec2-large-xlsr-53-finnish",
    "fa": "jonatasgrosman/wav2vec2-large-xlsr-53-persian",
    "el": "jonatasgrosman/wav2vec2-large-xlsr-53-greek",
    "tr": "mpoyraz/wav2vec2-xls-r-300m-cv7-turkish",
    "da": "saattrupdan/wav2vec2-xls-r-300m-ftspeech",
    "he": "imvladikon/wav2vec2-xls-r-300m-hebrew",
    "vi": 'nguyenvulebinh/wav2vec2-base-vi',
    "ko": "kresnik/wav2vec2-large-xlsr-korean",
    "ur": "kingabzpro/wav2vec2-large-xls-r-300m-Urdu",
    "te": "anuragshas/wav2vec2-large-xlsr-53-telugu",
    "hi": "theainerd/Wav2Vec2-large-xlsr-hindi",
    "ca": "softcatala/wav2vec2-large-xlsr-catala",
    "ml": "gvs/wav2vec2-large-xlsr-malayalam",
    "no": "NbAiLab/nb-wav2vec2-1b-bokmaal",
    "nn": "NbAiLab/nb-wav2vec2-300m-nynorsk",
}

def download_torch_align_models():
    for lang, model_name in DEFAULT_ALIGN_MODELS_TORCH.items():
        print(f"Downloading {model_name} for {lang}")
        bundle = torchaudio.pipelines.__dict__[model_name]
        bundle.get_model()
        print(f"Downloaded {model_name} for {lang}")

def download_huggingface_align_models():
    for lang, model_name in DEFAULT_ALIGN_MODELS_HF.items():
        print(f"Downloading {model_name} for {lang}")
        huggingface_hub.snapshot_download(model_name)
        print(f"Downloaded {model_name} for {lang}")


# Diarization - see https://github.com/m-bain/whisperX/blob/main/whisperx/diarize.py

def download_diarization_models(auth_token):
    pyannote_model="pyannote/speaker-diarization-3.1"
    print(f"Downloading diarization models {pyannote_model}")
    Pipeline.from_pretrained(pyannote_model, use_auth_token=auth_token)

# faster-whisper models

################
# Note - this section below is copied from https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/utils.py
# and then heavily simplified to only include the models we need
###############

WHISPER_MODELS = {
    "tiny": "Systran/faster-whisper-tiny",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large": "Systran/faster-whisper-large-v3",
}

def download_model(
        model: str,
):
    """Downloads a CTranslate2 Whisper model from the Hugging Face Hub.

    Args:
      model: Size of the model to download from https://huggingface.co/Systran
        (see https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/utils.py#L12 for full list) - here
        limited to tiny, small, medium, large.
    Returns:
      The path to the downloaded model.
    """
    print(f"Downloading whisper model {model}")
    repo_id = WHISPER_MODELS.get(model)

    allow_patterns = [
        "config.json",
        "preprocessor_config.json",
        "model.bin",
        "tokenizer.json",
        "vocabulary.*",
    ]

    kwargs = {
        "allow_patterns": allow_patterns,
    }

    return huggingface_hub.snapshot_download(repo_id, **kwargs)

def download_all_whisper_models():
    for model_name in WHISPER_MODELS.keys():
        download_model(model_name)

app = typer.Typer()

@app.command()
def main(
        whisper_models: bool = typer.Option(False, help="Download whisper models"),
        diarization_models: bool = typer.Option(False, help="Download diarization models"),
        torch_align_models: bool = typer.Option(False, help="Download torch align models"),
        huggingface_align_models: bool = typer.Option(False, help="Download huggingface align models"),
        huggingface_token: str = typer.Option("", help="Huggingface authentication token")):
    if whisper_models:
        download_all_whisper_models()
    if diarization_models:
        if not huggingface_token:
            print("Please provide a Huggingface authentication token (--huggingface-token <token>)")
            sys.exit(1)
        download_diarization_models(huggingface_token)
    if torch_align_models:
        download_torch_align_models()
    if huggingface_align_models:
        download_huggingface_align_models()


if __name__ == "__main__":
    typer.run(main)
