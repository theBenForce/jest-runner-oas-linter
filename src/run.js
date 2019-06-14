'use strict'

const fs = require('fs')
const path = require('path')
const { pass, fail } = require('create-jest-runner')
const {
  default: toTestResult
} = require('create-jest-runner/build/toTestResult')
const validator = require('oas-validator')
const oasLinter = require('oas-linter')
const pkgDir = require('pkg-dir')

const DEFAULT_CONFIG = {
  loadDefaultRules: true,
  rules: []
}

// Map an oas-linter warning to jest test result
const warningToTest = (duration, testPath) => warning => {
  const { ruleName, message, pointer } = warning

  return {
    duration,
    errorMessage: message, // Does not seem to be used in reporters
    testPath,
    title: `${message} - ${pointer} (${ruleName})`
  }
}

// Promisify async fs exists test
const exists = path =>
  new Promise((resolve, reject) =>
    fs.access(path, fs.constants.R_OK, err =>
      err ? reject(false) : resolve(true)
    )
  )

// Load config from .oaslint.json or from package.json oaslintConfig field
const loadConfig = testPath =>
  pkgDir(path.dirname(testPath)).then(dir => {
    if (!dir) return DEFAULT_CONFIG
    const rcFile = `${dir}/.oaslintrc.json`

    return exists(rcFile)
      .then(rcExists =>
        rcExists
          ? require(rcFile)
          : require(`${dir}/package.json`).oaslintConfig
      )
      .catch(error => {
        console.error(`Error loading oaslint config: ${error.message}`, error)
      })
      .then(config =>
        config ? { ...DEFAULT_CONFIG, ...config } : DEFAULT_CONFIG
      )
  })

// Run tests on a given file
const run = ({ testPath, config, globalConfig }) => {
  const schema = require(testPath)

  // Avoid caching for `--watch` mode
  delete delete require.cache[require.resolve(testPath)]

  const test = {
    path: testPath,
    title: 'OAS Linter'
  }
  const result = {
    start: Date.now(),
    test
  }

  if (!schema || typeof schema !== 'object') {
    return fail({
      ...result,
      end: Date.now(),
      test: {
        ...test,
        errorMessage: `${testPath} does not resolve to an object, cannot be a valid schema`
      }
    })
  }

  return loadConfig(testPath).then(
    config =>
      new Promise((resolve, reject) => {
        const { loadDefaultRules, rules = [] } = config
        const linter = oasLinter.getLinter()
        console.log(linter === oasLinter.getLinter())

        if (loadDefaultRules) linter.loadDefaultRules()
        if (rules.length) linter.applyRules({ rules })

        validator.validate(
          schema,
          {
            skip: false,
            lint: true,
            linter: linter.lint,
            linterResults: linter.getResults,
            prettify: true,
            verbose: false
          },
          (error, options) => {
            const { context, warnings, valid } = options || error.options
            result.end = Date.now()

            // All is well
            if (valid && !warnings.length) return resolve(pass(result))

            // Schema is not a valid schema
            if (!valid) {
              return resolve(
                fail({
                  ...result,
                  errorMessage: 'Not a valid OpenAPI schema.'
                })
              )
            }

            // Schema is valid, but warnings (lint failures) were present
            const tests = warnings.map(
              warningToTest(result.end - result.start, testPath)
            )
            resolve(
              toTestResult({
                errorMessage: tests[0].errorMessage,
                stats: {
                  failures: warnings.length,
                  pending: 0,
                  passes: 0,
                  todo: 0,
                  start: result.start,
                  end: result.end
                },
                tests,
                jestTestPath: testPath
              })
            )
          }
        )
      })
  )
}

module.exports = run
