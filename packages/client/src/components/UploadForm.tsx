import { authFetch } from '@/helpers';
import React, { useContext, useState } from 'react';
import {
	SignedUrlResponseBody,
	uploadToS3,
	languageCodeToLanguage,
	type LanguageCode,
	languageCodes,
	TranscribeFileRequestBody,
	MediaSourceType,
} from '@guardian/transcription-service-common';
import { AuthContext } from '@/app/template';
import {
	Checkbox,
	FileInput,
	Label,
	Select,
	Textarea,
	Radio,
	Alert,
} from 'flowbite-react';
import { RequestStatus } from '@/types';
import { InfoMessage } from '@/components/InfoMessage';
import { SubmitResult } from '@/components/SubmitResult';

const submitMediaUrl = async (
	url: string,
	token: string,
	languageCode: LanguageCode,
	translationRequested: boolean,
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
		}),
	});
	const success = response.status === 200;
	if (!success) {
		console.error('Failed to submit urls for transcription');
		return false;
	}
	return true;
};

const uploadFileAndTranscribe = async (
	file: File,
	token: string,
	languageCode: LanguageCode,
	translationRequested: boolean,
) => {
	const blob = new Blob([file as BlobPart]);

	const response = await authFetch(`/api/signed-url`, token);
	if (!response) {
		console.error('Failed to fetch signed url');
		return false;
	}

	const body = SignedUrlResponseBody.safeParse(await response.json());
	if (!body.success) {
		console.error('response from signedUrl endpoint in wrong shape');
		return false;
	}

	const uploadStatus = await uploadToS3(body.data.presignedS3Url, blob);
	if (!uploadStatus.isSuccess) {
		console.error('Failed to upload to s3');
		return false;
	}

	const transcribeFileBody: TranscribeFileRequestBody = {
		s3Key: body.data.s3Key,
		fileName: file.name,
		languageCode,
		translationRequested,
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

const checkUrlValid = (url: string) => {
	try {
		new URL(url);
		return true;
	} catch {
		return false;
	}
};

export const UploadForm = () => {
	const [status, setStatus] = useState<RequestStatus>(RequestStatus.Ready);
	const [files, setFiles] = useState<FileList | null>(null);
	const [uploads, setUploads] = useState<Record<string, RequestStatus>>({});
	const [mediaFileLanguageCode, setMediaFileLanguageCode] = useState<
		LanguageCode | undefined
	>(undefined);
	const [languageCodeValid, setLanguageCodeValid] = useState<
		boolean | undefined
	>(undefined);
	const [translationRequested, setTranslationRequested] =
		useState<boolean>(false);
	const [mediaSource, setMediaSource] = useState<MediaSourceType>('file');
	const [mediaUrlText, setMediaUrlText] = useState<string>('');
	const [mediaUrls, setMediaUrls] = useState<Record<string, RequestStatus>>({});
	const { token } = useContext(AuthContext);

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
			const urls = mediaUrlText.split('\n').filter((url) => url !== '');
			if (urls.length === 0) {
				return;
			}
			const urlsWithStatus = Object.fromEntries(
				urls.map((url) => [
					url,
					checkUrlValid(url) ? RequestStatus.InProgress : RequestStatus.Invalid,
				]),
			);
			const validUrls = urls.filter(checkUrlValid);
			setMediaUrls(urlsWithStatus);
			for (const url of validUrls) {
				const success = await submitMediaUrl(
					url,
					token,
					mediaFileLanguageCode,
					translationRequested,
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

	return (
		<>
			<p className={' pb-3 font-light'}>
				Use the form below to upload audio or video files. You will receive an
				email when the transcription is ready.
			</p>
			<form id="media-upload-form" onSubmit={handleSubmit}>
				<div className="flex items-center gap-2">
					I want to transcribe a...
					<Radio
						id="file-radio"
						name="media-type"
						value="file"
						defaultChecked
						onClick={() => setMediaSource('file')}
					/>
					<Label htmlFor="file-radio">File</Label>
					<Radio
						id="url-radio"
						name="media-type"
						value="url"
						onClick={() => setMediaSource('url')}
					/>
					<Label htmlFor="url-radio">URL</Label>
				</div>
				{mediaSource === 'url' && (
					<>
						<div className="mb-6"></div>

						<div className="mb-6">
							<div>
								<Label
									className="text-base"
									htmlFor="media-url"
									value="Url(s) for transcription (one per line)"
								/>
							</div>
							<Textarea
								id="media-url"
								placeholder="e.g. https://www.youtube.com?v=abc123"
								required
								rows={4}
								onChange={(e) => {
									setMediaUrlText(e.target.value);
								}}
							/>
						</div>
						<div className={'mb-6'}>
							<Alert color="info">
								Material on YouTube belongs to the copyright holder. Please only
								use this service to get a download of a video for legitimate
								journalistic purposes
							</Alert>
						</div>
					</>
				)}
				{mediaSource === 'file' && (
					<div className="mb-6">
						<div>
							<Label
								className="text-base"
								htmlFor="multiple-file-upload"
								value="File(s) for transcription"
							/>
						</div>
						<FileInput
							id="files"
							required={true}
							multiple
							onChange={(e) => {
								setFiles(e.target.files);
							}}
						/>
					</div>
				)}
				<div className="mb-6">
					<div>
						<Label
							className="text-base"
							htmlFor="language-selector"
							value="Audio language"
						/>
					</div>
					<p className="font-light">
						Choosing a specific language may give you more accurate results.
					</p>
					<Select
						id="language-selector"
						style={{
							color: languageSelectColor,
							borderColor: languageSelectColor,
						}}
						onChange={(e) => {
							setMediaFileLanguageCode(e.target.value as LanguageCode);
							setLanguageCodeValid(true);
						}}
					>
						<option disabled selected>
							Select a language
						</option>
						{languageCodes.map((languageCode: LanguageCode) => (
							<option key={languageCode} value={languageCode}>
								{languageCodeToLanguage[languageCode]}
							</option>
						))}
					</Select>
				</div>
				{mediaFileLanguageCode !== 'en' && (
					<div className="mb-6">
						<div className="flex gap-2">
							<div className="flex h-5 items-center">
								<Checkbox
									id="translation"
									checked={translationRequested}
									onChange={() =>
										setTranslationRequested(!translationRequested)
									}
								/>
							</div>
							<div className="flex flex-col">
								<Label htmlFor="shipping">Request English translation</Label>
								<div className="text-gray-500 dark:text-gray-300">
									<span className="text-xs font-normal">
										You will receive two documents: a transcript in the original
										language and a translation in English.
									</span>
								</div>
							</div>
						</div>
					</div>
				)}
				<button
					type="submit"
					className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
				>
					Submit
				</button>
			</form>
		</>
	);
};
