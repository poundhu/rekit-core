'use strict';

const path = require('path');
const _ = require('lodash');
const traverse = require('babel-traverse').default;
// const shell = require('shelljs');
const utils = require('./utils');
const vio = require('./vio');
const refactor = require('./refactor');
const constant = require('./constant');
const entry = require('./entry');
const template = require('./template');
const assert = require('./assert');

module.exports = {
  add(name) {
    assert.notEmpty(name);
    name = _.kebabCase(name);
    assert.featureNotExist(name);
    const targetDir = utils.joinPath(utils.getProjectRoot(), `src/features/${name}`);

    // if (vio.dirExists(targetDir)) {
    //   utils.fatalError(`Feature already exists: ${name}`);
    // }

    vio.mkdir(targetDir);
    vio.mkdir(utils.joinPath(targetDir, 'redux'));
    vio.mkdir(utils.joinPath(utils.getProjectRoot(), 'tests/features', name));
    vio.mkdir(utils.joinPath(utils.getProjectRoot(), 'tests/features', name, 'redux'));

    // Create files from template
    [
      'index.js',
      'route.js',
      'style.' + utils.getCssExt(),
      'redux/actions.js',
      'redux/reducer.js',
      'redux/constants.js',
      'redux/initialState.js',
    ].forEach((fileName) => {
      template.generate(utils.joinPath(targetDir, fileName), {
        templateFile: fileName,
        context: { feature: name }
      });
    });

    // Create wrapper reducer for the feature
    template.generate(utils.joinPath(utils.getProjectRoot(), `tests/features/${name}/redux/reducer.test.js`), {
      templateFile: 'reducer.test.js',
      context: { feature: name }
    });
  },

  remove(name) {
    vio.del(utils.joinPath(utils.getProjectRoot(), 'src/features', _.kebabCase(name)));
    vio.del(utils.joinPath(utils.getProjectRoot(), 'tests/features', _.kebabCase(name)));
  },

  move(oldName, newName) {
    // Summary:
    //  Rename a feature. Seems a bit heavy operation.

    assert.notEmpty(oldName);
    assert.notEmpty(newName);
    assert.featureExist(oldName);
    assert.featureNotExist(newName);

    oldName = _.kebabCase(oldName);
    newName = _.kebabCase(newName);

    const prjRoot = utils.getProjectRoot();

    // Move feature folder
    const oldFolder = utils.joinPath(prjRoot, 'src/features', oldName);
    const newFolder = utils.joinPath(prjRoot, 'src/features', newName);
    vio.moveDir(oldFolder, newFolder);

    // Move feature test folder
    const oldTestFolder = utils.joinPath(prjRoot, 'tests/features', oldName);
    const newTestFolder = utils.joinPath(prjRoot, 'tests/features', newName);
    vio.moveDir(oldTestFolder, newTestFolder);

    // Update common/routeConfig
    entry.renameInRouteConfig(oldName, newName);

    // Update common/rootReducer
    entry.renameInRootReducer(oldName, newName);

    // Update styles/index.less
    entry.renameInRootStyle(oldName, newName);

    // Update feature/route.js for path and name if they bind to feature name
    refactor.updateFile(utils.mapFeatureFile(newName, 'route.js'), ast => [].concat(
      refactor.replaceStringLiteral(ast, _.kebabCase(oldName), _.kebabCase(newName)), // Rename path
      refactor.replaceStringLiteral(ast, _.upperFirst(_.lowerCase(oldName)), _.upperFirst(_.lowerCase(newName))) // Rename name
    ));

    // Try to rename css class names for components
    const folder = utils.joinPath(prjRoot, 'src/features', newName);
    vio.ls(folder)
      // It simply assumes component file name is pascal case
      .filter(f => /^[A-Z]/.test(path.basename(f)))
      .forEach((filePath) => {
        const moduleName = path.basename(filePath).split('.')[0];

        if (/\.js$/.test(filePath)) {
          // For components, update the css class name inside
          refactor.updateFile(filePath, ast => [].concat(
            refactor.replaceStringLiteral(ast, `${oldName}-${_.kebabCase(moduleName)}`, `${newName}-${_.kebabCase(moduleName)}`, false) // rename css class name
          ));
        } else if (/\.less$|\.scss$/.test(filePath)) {
          // For style update
          let lines = vio.getLines(filePath);
          const oldCssClass = `${oldName}-${_.kebabCase(moduleName)}`;
          const newCssClass = `${newName}-${_.kebabCase(moduleName)}`;

          lines = lines.map(line => line.replace(`.${oldCssClass}`, `.${newCssClass}`));
          vio.save(filePath, lines);
        }
      });

    // Rename action constants
    const reduxFolder = utils.joinPath(prjRoot, 'src/features', newName, 'redux');
    const constantsFile = utils.joinPath(reduxFolder, 'constants.js');
    const constants = [];
    traverse(vio.getAst(constantsFile), {
      VariableDeclarator(p) {
        const name = _.get(p, 'node.id.name');
        if (name && _.startsWith(name, `${_.upperSnakeCase(oldName)}_`) && name === _.get(p, 'node.init.value')) {
          constants.push(name);
        }
      }
    });

    constants.forEach((name) => {
      const oldConstant = name;
      const newConstant = name.replace(new RegExp(`^${_.upperSnakeCase(oldName)}`), _.upperSnakeCase(newName));
      constant.rename(newName, oldConstant, newConstant);
    });

    // Rename actions
    const reduxTestFolder = utils.joinPath(prjRoot, 'tests/features', newName, 'redux');
    vio.ls(reduxFolder)
    .concat(vio.ls(reduxTestFolder))
      // It simply assumes component file name is pascal case
      .forEach((filePath) => {
        if (/\.js$/.test(filePath)) {
          refactor.updateFile(filePath, (ast) => {
            let changes = [];
            constants.forEach((name) => {
              const oldConstant = name;
              const newConstant = name.replace(new RegExp(`^${_.upperSnakeCase(oldName)}`), _.upperSnakeCase(newName));
              changes = changes.concat(refactor.renameImportSpecifier(ast, oldConstant, newConstant));
            });
            return changes;
          });
        }
      });

    // Try to do a rougth string replacement based on the original generated code structure
    const testFolder = utils.joinPath(prjRoot, 'tests/features', newName);
    // const files = _.union(vio.ls(testFolder), vio.ls(utils.joinPath(testFolder, 'redux'))
    _.union(vio.ls(testFolder), vio.ls(utils.joinPath(testFolder, 'redux')))
      .filter(f => /\.test\.js$/.test(f))
      .forEach((filePath) => {
        const moduleName = path.basename(filePath).replace('.test.js', '');
        refactor.updateFile(filePath, ast => [].concat(
          refactor.replaceStringLiteral(ast, `src/features/${oldName}`, `src/features/${newName}`), // import module path
          refactor.replaceStringLiteral(ast, `../../../src/features/${oldName}'`, `../../../src/features/${newName}`), // import module path
          refactor.replaceStringLiteral(ast, `features/${oldName}/`, `features/${newName}/`, false), // import module path
          refactor.replaceStringLiteral(ast, `${oldName}/${moduleName}`, `${newName}/${moduleName}`), // describe component/page test
          refactor.replaceStringLiteral(ast, `${oldName}/redux/${moduleName}`, `${newName}/redux/${moduleName}`), // describe action test
          refactor.replaceStringLiteral(ast, `${oldName}/redux/reducer`, `${newName}/redux/reducer`), // describe reducer test
          refactor.replaceStringLiteral(ast, `${oldName}-${_.kebabCase(moduleName)}`, `${newName}-${_.kebabCase(moduleName)}`, false) // root css class name
        ));
      });
  },

  // move(oldName, newName) {
  //   // Summary:
  //   //  Rename a feature. Seems very heavy.
  //   assert.notEmpty(oldName);
  //   assert.notEmpty(newName);
  //   assert.featureExist(oldName);
  //   assert.featureNotExist(newName);

  //   oldName = _.kebabCase(oldName);
  //   newName = _.kebabCase(newName);

  //   const prjRoot = utils.getProjectRoot();

  //   // Move feature folder
  //   const oldFolder = utils.joinPath(prjRoot, 'src/features', oldName);
  //   const newFolder = utils.joinPath(prjRoot, 'src/features', newName);
  //   shell.mv(oldFolder, newFolder);

  //   // Move feature test folder
  //   const oldTestFolder = utils.joinPath(prjRoot, 'tests/features', oldName);
  //   const newTestFolder = utils.joinPath(prjRoot, 'tests/features', newName);
  //   shell.mv(oldTestFolder, newTestFolder);

  //   // Update common/routeConfig
  //   entry.renameInRouteConfig(oldName, newName);

  //   // Update common/rootReducer
  //   entry.renameInRootReducer(oldName, newName);

  //   // Update styles/index.less
  //   entry.renameInRootStyle(oldName, newName);

  //   // Update feature/route.js for path and name if they bind to feature name
  //   refactor.updateFile(utils.mapFeatureFile(newName, 'route.js'), ast => [].concat(
  //     refactor.renameStringLiteral(ast, _.kebabCase(oldName), _.kebabCase(newName)), // Rename path
  //     refactor.renameStringLiteral(ast, _.upperFirst(_.lowerCase(oldName)), _.upperFirst(_.lowerCase(newName))) // Rename name
  //   ));

  //   // Try to rename css class names for components/pages
  //   const folder = utils.joinPath(prjRoot, 'src/features', newName);
  //   shell.ls(folder)
  //     .filter(f => /^[A-Z]/.test(path.basename(f)))
  //     .forEach((filePath) => {
  //       const moduleName = path.basename(filePath).split('.')[0];
  //       const absPath = utils.joinPath(folder, filePath);
  //       if (/\.js$/.test(filePath)) {
  //         // For components, update the css class name inside
  //         refactor.updateFile(absPath, ast => [].concat(
  //           refactor.renameStringLiteral(ast, `${oldName}-${_.kebabCase(moduleName)}`, `${newName}-${_.kebabCase(moduleName)}`) // rename css class name
  //         ));
  //       } else if (/\.less$|\.scss$/.test(filePath)) {
  //         // For style update
  //         let lines = vio.getLines(absPath);
  //         const oldCssClass = `${oldName}-${_.kebabCase(moduleName)}`;
  //         const newCssClass = `${newName}-${_.kebabCase(moduleName)}`;

  //         lines = lines.map(line => line.replace(`.${oldCssClass}`, `.${newCssClass}`));
  //         vio.save(absPath, lines);
  //       }
  //     });

  //   // Try to do a rougth string replacement based on the original generated code structure
  //   const testFolder = utils.joinPath(prjRoot, 'tests/features', newName);
  //   shell.ls('-R', testFolder)
  //     .filter(f => /\.test\.js$/.test(f))
  //     .forEach((filePath) => {
  //       const moduleName = path.basename(filePath).replace('.test.js', '');
  //       refactor.updateFile(utils.joinPath(testFolder, filePath), ast => [].concat(
  //         refactor.renameStringLiteral(ast, `src/features/${oldName}`, `src/features/${newName}`), // import module path
  //         refactor.renameStringLiteral(ast, `src/features/${oldName}/${moduleName}`, `src/features/${newName}/${moduleName}`), // import module path
  //         refactor.renameStringLiteral(ast, `src/features/${oldName}/redux/reducer`, `src/features/${newName}/redux/reducer`), // import module path
  //         refactor.renameStringLiteral(ast, `src/features/${oldName}/redux/constants`, `src/features/${newName}/redux/constants`), // import module path
  //         refactor.renameStringLiteral(ast, `src/features/${oldName}/redux/${moduleName}`, `src/features/${newName}/redux/${moduleName}`), // import module path
  //         refactor.renameStringLiteral(ast, `${oldName}/${moduleName}`, `${newName}/${moduleName}`), // describe component/page test
  //         refactor.renameStringLiteral(ast, `${oldName}/redux/${moduleName}`, `${newName}/redux/${moduleName}`), // describe action test
  //         refactor.renameStringLiteral(ast, `${oldName}/redux/reducer`, `${newName}/redux/reducer`), // describe reducer test
  //         refactor.renameStringLiteral(ast, `.${oldName}-${_.kebabCase(moduleName)}`, `.${newName}-${_.kebabCase(moduleName)}`) // root css class name
  //       ));
  //     });
  // },
};
