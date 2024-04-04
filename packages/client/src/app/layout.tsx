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
								Guardian Transcription Tool
							</h1>
							<span className="bg-green-100 text-green-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded dark:bg-green-900 dark:text-green-300">
								Beta
							</span>
						</div>
						<p className={'italic pt-1 font-light '}>
							This a new tool developed by the Digital Investigations and
							Reporting team. Any feedback would be very welcome -
							digital.investigations@theguardian.com
						</p>
					</div>
				</header>
				<main>
					<div className="mx-auto max-w-7xl py-6 sm:px-6 lg:px-8 px-4">
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
