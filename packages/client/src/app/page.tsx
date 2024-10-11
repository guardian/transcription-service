'use client';
import React from 'react';
import { UploadForm } from '../components/UploadForm';
const Home = () => {
	return (
		<>
			<p className={' pb-3 font-light'}>
				Use the form below to upload audio or video files. You will
				receive an email when the transcription is ready.
			</p>
			<UploadForm></UploadForm>
		</>
	);
};

export default Home;
