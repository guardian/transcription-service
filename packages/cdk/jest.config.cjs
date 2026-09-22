module.exports = {
	testMatch: ['<rootDir>/{lib,bin}/**/*.test.ts'],
	transform: {
		'^.+\\.tsx?$': ['ts-jest', { compiler: require.resolve('typescript') }],
	},
	setupFilesAfterEnv: ['./jest.setup.js'],
};
