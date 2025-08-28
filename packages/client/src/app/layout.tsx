import { Footer } from 'flowbite-react';
import './globals.css';
import React from 'react';
export default function RootLayout({
	// Layouts must accept a children prop.
	// This will be populated with nested layouts or pages
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<link rel="icon" href="favicon.ico" sizes="any" />
			<body>
				<header className="bg-white shadow">
					<div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
						<div className="flex items-center space-x-2">
							<h1 className="text-3xl font-bold tracking-tight text-gray-900">
								Guardian transcription tool
							</h1>
						</div>
						<p className={'italic pt-1 font-light '}>
							This is a tool developed for GNM by the Investigations and
							Reporting engineering team. Please email feedback / bug reports to
							<a
								href="https://mail.google.com/mail/?view=cm&fs=1&to=digital.investigations@theguardian.com&su=Guardian%20Transcription%20Tool%20feedback"
								target="_blank"
							>
								digital.investigations@theguardian.com
							</a>
						</p>
					</div>
				</header>
				<main>
					<div className="mx-auto max-w-7xl py-6 sm:px-6 lg:px-8 px-4 pb-20">
						{children}
					</div>
				</main>
				<Footer container className="fixed bottom-0 md:justify-end">
					<Footer.LinkGroup>
						<Footer.Link
							target="_blank"
							href="https://docs.google.com/document/d/1e224Fe5tJJNeLBNvYLVJ4FWd_O-1nwrJcqKyEXI03lA"
						>
							About this tool
						</Footer.Link>
					</Footer.LinkGroup>
				</Footer>
			</body>
		</html>
	);
}
