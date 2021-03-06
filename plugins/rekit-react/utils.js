const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const prefix = require('./prefix');

const { config, paths } = rekit.core;

const pascalCase = _.flow(
  _.camelCase,
  _.upperFirst,
);

const upperSnakeCase = _.flow(
  _.snakeCase,
  _.toUpper,
);

// Parse and normalize an element paths, names
function parseElePath(elePath, type = 'component') {
  const arr = elePath.split('/');
  const feature = _.kebabCase(arr.shift());
  let name = arr.pop();
  if (type === 'action') name = _.camelCase(name);
  else if (type === 'component') name = pascalCase(name);
  else throw new Error('Unknown element type: ' + type + ' of ' + elePath);
  elePath = [feature, ...arr, name].join('/');

  const ele = {
    name,
    path: elePath,
    feature,
  };

  if (type === 'component') {
    ele.modulePath = `src/features/${elePath}.js`;
    ele.testPath = `tests/features/${elePath}.test.js`;
    ele.stylePath = `src/features/${elePath}.${config.getRekitConfig().css}`;
  } else if (type === 'action') {
    ele.modulePath = `src/features/${feature}/redux/${name}.js`;
    ele.testPath = `tests/features/${feature}/redux/${name}.test.js`;
  }
  return ele;
}

/**
 * Get action type constant for a sync action. It uses UPPER_SNAKE_CASE and combines feature name and action name.
 * @param {string} feature - The feature name of the action.
 * @param {string} action - The action name.
 *
 * @example
 * const utils = require('rekit-core').utils;
 * utils.getActionType('home', 'doSomething');
 * // => HOME_DO_SOMETHING
 **/
function getActionType(feature, action) {
  const pre = prefix.getPrefix() ? upperSnakeCase(prefix.getPrefix()) + '$' : '';
  return `${pre}${upperSnakeCase(feature)}_${upperSnakeCase(action)}`;
}

/**
 * Get action type constants for an async action. It uses UPPER_SNAKE_CASE and combines feature name and action name.
 * @param {string} feature - The feature name of the action.
 * @param {string} action - The action name.
 *
 * @example
 * const utils = require('rekit-core').utils;
 * utils.getAsyncActionTypes('home', 'doAsync');
 * // =>
 * // {
 * //   doAsyncBegin: 'HOME_DO_ASYNC_BEGIN',
 * //   doAsyncSuccess: 'HOME_DO_ASYNC_SUCCESS',
 * //   doAsyncFailure: 'HOME_DO_ASYNC_FAILURE',
 * //   doAsyncDismissError: 'HOME_DO_ASYNC_DISMISS_ERROR',
 * // }
 **/
function getAsyncActionTypes(feature, action) {
  const f = upperSnakeCase(feature);
  const a = upperSnakeCase(action);
  const pre = prefix.getPrefix() ? upperSnakeCase(prefix.getPrefix()) + '$' : '';
  return {
    normal: getActionType(feature, action),
    begin: `${pre}${f}_${a}_BEGIN`,
    success: `${pre}${f}_${a}_SUCCESS`,
    failure: `${pre}${f}_${a}_FAILURE`,
    dismissError: `${pre}${f}_${a}_DISMISS_ERROR`,
  };
}

// Get the template file path
function getTplPath(tpl) {
  const tplFile = path.join(__dirname, './templates', tpl);
  const customTplDir =
    _.get(config.getRekitConfig(), 'rekitReact.templateDir') ||
    path.join(paths.map('.rekit-react/templates'));
  const customTplFile = path.join(customTplDir, tpl);
  return fs.existsSync(customTplFile) ? customTplFile : tplFile;
}

module.exports = {
  parseElePath,
  getActionType,
  getAsyncActionTypes,
  getTplPath,
  pascalCase,
  upperSnakeCase,
};
