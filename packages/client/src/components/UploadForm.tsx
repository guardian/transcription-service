import { addHttpsProtocol, authFetch } from '@/helpers';
import React, { useContext, useEffect, useState } from 'react';
import {
	SignedUrlResponseBody,
	uploadToS3,
	languageCodes,
	TranscribeFileRequestBody,
	MediaSourceType,
	InputLanguageCode,
	languageCodeToLanguageWithAuto,
	YoutubeStatus,
} from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import {
	Checkbox,
	FileInput,
	Label,
	Select,
	Radio,
	Alert,
	TextInput,
	Button,
} from 'flowbite-react';
import { MediaUrlInput, RequestStatus } from '@/types';
import { InfoMessage } from '@/components/InfoMessage';
import { SubmitResult } from '@/components/SubmitResult';
import { ExclamationTriangleIcon, PlusIcon } from '@heroicons/react/16/solid';

const getStatusColor = (input: MediaUrlInput) => {
	switch (input.status) {
		case 'invalid':
			return 'failure';
		case 'valid':
			return 'success';
		default:
			return '';
	}
};

const submitMediaUrl = async (
	url: string,
	token: string,
	languageCode: InputLanguageCode,
	translationRequested: boolean,
	diarizationRequested: boolean,
) => {
	const response = await authFetch('/api/transcribe-url', token, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			url,
			languageCode,
			translationRequested,
			diarizationRequested,
		}),
	});
	const success = response.status === 200;
	if (!success) {
		console.error('Failed to submit URLs for transcription');
		return false;
	}
	return true;
};

const uploadFileAndTranscribe = async (
	file: File,
	token: string,
	languageCode: InputLanguageCode,
	translationRequested: boolean,
	diarizationRequested: boolean,
) => {
	const blob = new Blob([file as BlobPart]);

	const response = await authFetch(`/api/signed-url`, token, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			fileName: file.name,
		}),
	});
	if (!response) {
		console.error('Failed to fetch signed url');
		return false;
	}

	const body = SignedUrlResponseBody.safeParse(await response.json());
	if (!body.success) {
		console.error('response from signedUrl endpoint in wrong shape');
		return false;
	}

	const uploadStatus = await uploadToS3(body.data.presignedS3Url, blob, false);
	if (!uploadStatus.isSuccess) {
		console.error('Failed to upload to s3');
		return false;
	}

	const transcribeFileBody: TranscribeFileRequestBody = {
		s3Key: body.data.s3Key,
		fileName: file.name,
		languageCode,
		translationRequested,
		diarizationRequested,
	};

	const sendMessageResponse = await authFetch('/api/transcribe-file', token, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(transcribeFileBody),
	});
	const sendMessageSuccess = sendMessageResponse.status === 200;
	if (!sendMessageSuccess) {
		console.error('Failed to call transcribe-file');
		return false;
	}
	return true;
};

const updateFileStatus = (
	uploads: Record<string, RequestStatus>,
	index: number,
	fileName: string,
	newStatus: RequestStatus,
) => {
	return {
		...uploads,
		[`${index}-${fileName}`]: newStatus,
	};
};

const checkUrlValid = (url_input: string): MediaUrlInput => {
	try {
		if (url_input === '') {
			return { value: url_input, status: 'empty' };
		}
		const cleanedUrlInput = addHttpsProtocol(url_input);
		const url = new URL(cleanedUrlInput);
		// we don't want people providing search results pages as yt-dlp will try and fetch every video
		if (
			url.pathname.includes('results') &&
			url.search.includes('search_query')
		) {
			return {
				value: url_input,
				reason:
					'That URL is a link to search results. Please link to a video page',
				status: 'invalid',
			};
		}
		return { value: url_input, status: 'valid' };
	} catch {
		return { value: url_input, reason: 'Invalid URL', status: 'invalid' };
	}
};

const renderYoutubeStatus = (status?: YoutubeStatus) => {
	if (!status || status === 'LIVE') {
		return null;
	} else
		return (
			<div className="mb-4">
				{status === 'WARN' && (
					<Alert color="warning" icon={ExclamationTriangleIcon}>
						Youtube recently blocked a request from the transcription service.
						There is a high chance youtube urls may fail, in which case you'll
						need to manually download the media from youtube rather than using
						this service. Other sites are unaffected.
					</Alert>
				)}
				{status === 'ERROR' && (
					<Alert color="failure" icon={ExclamationTriangleIcon}>
						Youtube downloads are currently not working. You will need to
						manually download the media from youtube and use the file upload
						option rather than using this service. Other sites are unaffected.
					</Alert>
				)}
			</div>
		);
};

export const UploadForm = () => {
	const [status, setStatus] = useState<RequestStatus>(RequestStatus.Ready);
	const [files, setFiles] = useState<FileList | null>(null);
	const [uploads, setUploads] = useState<Record<string, RequestStatus>>({});
	const [mediaFileLanguageCode, setMediaFileLanguageCode] = useState<
		InputLanguageCode | undefined
	>(undefined);
	const [languageCodeValid, setLanguageCodeValid] = useState<
		boolean | undefined
	>(undefined);
	const [translationRequested, setTranslationRequested] =
		useState<boolean>(false);
	const [diarizationRequested, setDiarizationRequested] =
		useState<boolean>(false);
	const [mediaSource, setMediaSource] = useState<MediaSourceType>('file');
	const [mediaUrls, setMediaUrls] = useState<Record<string, RequestStatus>>({});
	const [mediaUrlInputs, setMediaUrlInputs] = useState<MediaUrlInput[]>([
		{ status: 'empty', value: '' },
	]);
	const { token } = useContext(AuthContext);
	const [youtubeStatus, setYoutubeStatus] = useState<YoutubeStatus | undefined>(
		undefined,
	);

	useEffect(() => {
		if (token) {
			authFetch('/api/youtube-status', token).then((response) => {
				if (response.status === 200) {
					response.json().then((json) => {
						const parsed = YoutubeStatus.safeParse(json.status);
						if (parsed.success) {
							setYoutubeStatus(parsed.data);
						}
					});
				}
			});
		}
	}, [youtubeStatus]);

	const reset = () => {
		setStatus(RequestStatus.Ready);
		setUploads({});
		setFiles(null);
		setMediaFileLanguageCode(undefined);
		setLanguageCodeValid(undefined);
	};

	if (!token) {
		return (
			<InfoMessage message={'Login required'} status={RequestStatus.Failed} />
		);
	}

	if (status !== RequestStatus.Ready) {
		const progressList = mediaSource === 'url' ? mediaUrls : uploads;
		console.log(progressList);
		return (
			<SubmitResult
				mediaSource={mediaSource}
				formStatus={status}
				mediaWithStatus={progressList}
				reset={reset}
			/>
		);
	}

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		// The react Select components with a required property don't show any
		// feedback when the form is submitted without an option having been
		// chosen. We need to validate that input manually.
		if (mediaFileLanguageCode === undefined) {
			setLanguageCodeValid(false);
			return;
		}

		setStatus(RequestStatus.InProgress);

		if (mediaSource === 'url') {
			const urls = mediaUrlInputs
				.filter((input) => input.status === 'valid')
				.map((input) => input.value.trim());
			if (urls.length === 0) {
				return;
			}
			const urlsWithStatus = Object.fromEntries(
				urls.map((url) => [url, RequestStatus.InProgress]),
			);
			setMediaUrls(urlsWithStatus);
			for (const url of urls) {
				const urlWithProtocol = addHttpsProtocol(url);
				const success = await submitMediaUrl(
					urlWithProtocol,
					token,
					mediaFileLanguageCode,
					translationRequested,
					diarizationRequested,
				);
				if (success) {
					setMediaUrls((prev) => ({
						...prev,
						[url]: RequestStatus.Success,
					}));
				} else {
					setMediaUrls((prev) => ({
						...prev,
						[url]: RequestStatus.Failed,
					}));
					setStatus(RequestStatus.Failed);
				}
			}
			setStatus(RequestStatus.Success);
			return;
		}

		// the required property on the file input should prevent the form from
		// being submitted without any files selected. Need to confirm this in
		// order to narrow the type of files
		if (files === null || files.length === 0) {
			return;
		}

		const fileArray = Array.from(files);
		const fileIds = fileArray.map((f, index) => [
			`${index}-${f.name}`,
			RequestStatus.InProgress,
		]);
		setUploads(Object.fromEntries(fileIds));

		for (const [index, file] of fileArray.entries()) {
			const result = await uploadFileAndTranscribe(
				file,
				token,
				mediaFileLanguageCode,
				translationRequested,
				diarizationRequested,
			);
			if (!result) {
				setUploads((prev) =>
					updateFileStatus(prev, index, file.name, RequestStatus.Failed),
				);
				setStatus(RequestStatus.Failed);
			} else {
				setUploads((prev) =>
					updateFileStatus(prev, index, file.name, RequestStatus.Success),
				);
			}
		}

		setStatus(RequestStatus.Success);
	};

	const languageSelectColor = languageCodeValid === false ? 'red' : '';

	const addUrlInput = () =>
		setMediaUrlInputs([...mediaUrlInputs, { status: 'empty', value: '' }]);

	const atLeastOneValidUrl = () =>
		mediaUrlInputs.some((input) => input.status === 'valid');

	const disableSubmitButton = () => {
		if (mediaSource === 'file') {
			return files === null || files.length === 0;
		}
		return !atLeastOneValidUrl();
	};

	return (
		<>
			<p className={' pb-3 font-light'}>
				This tool can transcribe both audio and video. You will receive an email
				when the transcription is ready.
			</p>

			<form id="media-upload-form" onSubmit={handleSubmit}>
				<div className={'mb-1'}>
					<Label className="text-base">I want to transcribe a...</Label>
				</div>
				<div className="flex items-center gap-2 mb-3 ml-3">
					<Radio
						id="file-radio"
						name="media-type"
						value="file"
						checked={mediaSource === 'file'}
						onClick={() => setMediaSource('file')}
					/>
					<Label htmlFor="file-radio">File</Label>
					<Radio
						id="url-radio"
						name="media-type"
						value="url"
						checked={mediaSource === 'url'}
						onClick={() => setMediaSource('url')}
					/>
					<Label htmlFor="url-radio">URL</Label>
				</div>
				{mediaSource === 'url' && (
					<>
						<div className="mb-4"></div>
						{renderYoutubeStatus(youtubeStatus)}
						<div className="mb-4">
							<div className={'mb-1'}>
								<Label
									className="text-base"
									htmlFor="media-url"
									value="URL(s) for transcription"
								/>
								<p className="font-light">
									Paste the URL of a webpage or social media post containing the
									video or audio that you wish to save/transcribe. Click ‘+ Add
									URL’ to add multiple URLs.
								</p>
							</div>
							<div className={'ml-3'}>
								{mediaUrlInputs.map((input, index) => (
									<>
										<TextInput
											id={`media-url-${index}`}
											placeholder="e.g. https://www.youtube.com?v=abc123"
											className={'mt-1 mb-1'}
											color={getStatusColor(input)}
											helperText={
												input.status === 'invalid' ? input.reason : ''
											}
											onChange={(e) => {
												const newInputs = [...mediaUrlInputs];
												newInputs[index] = checkUrlValid(e.target.value);
												setMediaUrlInputs(newInputs);
											}}
										/>
										<hr className="h-0.5 my-2 bg-gray-200 border-0 dark:bg-gray-700" />
									</>
								))}
								<Button
									size={'sm'}
									className={'mt-2'}
									onClick={addUrlInput}
									color={'light'}
								>
									<PlusIcon className="mr-2 h-5 w-5" />
									Add URL
								</Button>
							</div>
						</div>
						<div className={'mb-4'}>
							<Alert color="info">
								Material may be protected by copyright. Please only use this
								service to get a download for legitimate journalistic purposes.
							</Alert>
						</div>
					</>
				)}
				{mediaSource === 'file' && (
					<div className="mb-4">
						<div className={'mb-1'}>
							<Label
								className="text-base"
								htmlFor="multiple-file-upload"
								value="File(s) for transcription"
							/>
						</div>
						<div className={'ml-3'}>
							<FileInput
								id="files"
								required={true}
								multiple
								onChange={(e) => {
									setFiles(e.target.files);
								}}
							/>
						</div>
					</div>
				)}
				<div className="mb-4">
					<div className={'mb-1'}>
						<Label
							className="text-base"
							htmlFor="language-selector"
							value="Audio language"
						/>
						<p className="font-light">
							Choosing a specific language may give you more accurate results.
						</p>
					</div>
					<div className={'ml-3'}>
						<Select
							id="language-selector"
							style={{
								color: languageSelectColor,
								borderColor: languageSelectColor,
							}}
							onChange={(e) => {
								setMediaFileLanguageCode(e.target.value as InputLanguageCode);
								setLanguageCodeValid(true);
							}}
						>
							<option disabled selected>
								Select a language
							</option>
							{languageCodes.map((languageCode: InputLanguageCode) => (
								<option key={languageCode} value={languageCode}>
									{languageCodeToLanguageWithAuto[languageCode]}
								</option>
							))}
						</Select>
					</div>
				</div>
				{mediaFileLanguageCode !== 'en' && (
					<div className="mb-4">
						<div className={'mb-1'}>
							<Label
								className="text-base"
								htmlFor="translation-checkbox"
								value="English translation"
							/>
							<p className="font-light">
								If you request a translation, you will receive two emails - one
								with the transcript in the original language, and another with
								the translation into English. Translation quality varies.
							</p>
						</div>
						<div className={'ml-3'}>
							<div className="flex h-5 items-center gap-2">
								<Checkbox
									id="translation"
									checked={translationRequested}
									onChange={() =>
										setTranslationRequested(!translationRequested)
									}
								/>
								<div className="flex flex-col">
									<Label htmlFor="translation" className="font-light text-base">
										Request translation
									</Label>
								</div>
							</div>
						</div>
					</div>
				)}

				<div className="mb-4">
					<div className={'mb-1'}>
						<Label
							className="text-base"
							htmlFor="diarization-checkbox"
							value="Speaker identification"
						/>
						<p className="font-light">
							Speaker identification is a new feature - please share any
							feedback with us.
						</p>
					</div>
					<div className={'ml-3'}>
						<div className="flex h-5 items-center gap-2">
							<Checkbox
								id="diarization"
								checked={diarizationRequested}
								onChange={() => setDiarizationRequested(!diarizationRequested)}
							/>
							<div className="flex flex-col">
								<Label htmlFor="diarization" className="font-light text-base">
									Request speaker identification
								</Label>
							</div>
						</div>
					</div>
				</div>

				<button
					type="submit"
					className={`text-white px-5 py-2.5 text-center rounded-lg text-sm font-medium ${
						disableSubmitButton()
							? 'bg-blue-400 dark:bg-blue-500 cursor-not-allowed'
							: 'bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 inline-flex items-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800'
					}`}
					disabled={disableSubmitButton()}
				>
					Submit
				</button>
			</form>
		</>
	);
};
