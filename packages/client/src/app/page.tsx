'use client';
import React from 'react';
import { UploadForm } from '../components/UploadForm';
const Home = () => {
	return (
		<>
			<p className={' pb-3 font-light'}>
				Use the form below to upload your files for transcription. You will
				receive an email when the transcription process is complete. Choosing
				audio language may improve accuracy.
			</p>
			<UploadForm></UploadForm>
		</>
	);
};

export default Home;
