/** @type {import('next').NextConfig} */
const nextConfig = {
	allowedDevOrigins: ['transcribe.local.dev-gutools.co.uk'],
	reactStrictMode: true,
	output: 'export',
	rewrites: async () => {
		return [
			{
				source: '/api/:any*',
				destination: 'http://localhost:9103/api/:any*',
			},
		];
	},
};

export default nextConfig;
