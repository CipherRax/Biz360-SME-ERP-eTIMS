module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testPathIgnorePatterns: ['<rootDir>/src/app/api'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'node',
          target: 'ES2022',
          esModuleInterop: true,
          allowJs: true,
          isolatedModules: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironmentOptions: {
    customExportConditions: [''],
  },
};