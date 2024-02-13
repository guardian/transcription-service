'use client';
import React from 'react';
import { UploadForm } from '../components/UploadForm';
import { useContext } from 'react';
import { AuthContext } from './template';

const Home = () => {
	const auth = useContext(AuthContext);
	return (
		<div>
			<h2>Upload file for transcribing</h2>
			<UploadForm auth={auth}></UploadForm>
		</div>
	);
};

export default Home;
