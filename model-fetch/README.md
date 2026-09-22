# model-fetch

The scripts in this folder are used by the 'fetch-models' github action to bundle up all models
needed by the transcription service into a single zip file so that we can run the workers offline.

For both whisperx and rapidocr there's no obvious archive to fetch - we have to use the functionality
within the tools themselves to fetch the models - hence these python scripts.

## whisperx

The simpler of the two scripts. Note that the script is setup to support fetchingf the alignment models,
we don't use alignment in whisperx at the moment - see the github action for the current params passed
to the script.

## Rapidocr

The downloader reads the worker's configuration and RapidOCR's pinned model
registry. It downloads the configured detector and classifier, every recognition
model matching the configured version and size, and the default visualization
font. SHA-256 checks must pass before the archive is uploaded. Recognition
dictionaries are embedded in these ONNX models.

The workflow also runs `verify_rapidocr_offline.py` to initialize and run every recognizer
with HTTP requests and socket connections blocked before uploading the archive.

We tell rapidocr what models to use in `packages/worker/rapidocr/rapidocr-config.local.yaml`. If
that file is changed then the rapidocr download/verify scripts may need to be adjusted accordingly

The current configuration uses PP-OCRv6 small detection, the v4 classifier, and
PP-OCRv4 mobile recognition. This covers English, simplified/traditional Chinese,
Latin languages (including French, German and Spanish), Arabic and Cyrillic,
plus the other v4 mobile recognition families.

To run the scripts locally you can use `uv` like this. Note that we pass `--no-project`
because the current `uv` project is only used for installing whisperx on dev machines.

```bash
uv run --no-project --with-requirements model-fetch/requirements.txt python rapidocr-model-fetch/download_rapidocr_models.py --output-dir ~/.cache/rapidocr
uv run --no-project --with-requirements model-fetch/requirements.txt python rapidocr-model-fetch/verify_rapidocr_offline.py --models-dir ~/.cache/rapidocr
```

The fetch environment uses RapidOCR 3.9.2. Keep the worker AMI's RapidOCR version
aligned with this pin; a different model registry may expect different filenames
or checksums. The AMI also needs rapidocr[rtl] for Arabic recognition - see
https://github.com/RapidAI/RapidOCR/blob/main/python/rapidocr/utils/utils.py#L21

Local development and model-fetch verification use `rapidocr-config.local.yaml`
with CPU inference. Deployed workers (CODE and PROD) use
`rapidocr-config.prod.yaml`, which enables ONNX Runtime CUDA on GPU 0. FPM bundles
only the production config. Both configs use the same models and cache paths;
keep their model settings aligned. The worker AMI must provide `onnxruntime-gpu`
and compatible CUDA/cuDNN libraries.
