'use strict';

module.exports = function(acorn) {
  let acornVersion = acorn.version.match(/^5\.(\d+)\./)
  if (!acornVersion || Number(acornVersion[1]) < 2) {
    throw new Error("Unsupported acorn version " + acorn.version + ", please use acorn 5 >= 5.2");
  }
  var tt = acorn.tokTypes;

  const getCheckLVal = origCheckLVal => function (expr, bindingType, checkClashes) {
    if (expr.type == "ObjectPattern") {
      for (let prop of expr.properties)
        this.checkLVal(prop, bindingType, checkClashes)
      return
    } else if (expr.type === "Property") {
      // AssignmentProperty has type == "Property"
      return this.checkLVal(expr.value, bindingType, checkClashes)
    }
    return origCheckLVal.apply(this, arguments)
  }

  acorn.plugins.objectSpread = function objectSpreadPlugin(instance) {
    instance.extend("parseProperty", nextMethod => function (isPattern, refDestructuringErrors) {
      if (this.options.ecmaVersion >= 6 && this.type === tt.ellipsis) {
        let prop
        if (isPattern) {
          prop = this.startNode()
          this.next()
          prop.argument = this.parseIdent()
          this.finishNode(prop, "RestElement")
        } else {
          prop = this.parseSpread(refDestructuringErrors)
        }
        if (this.type === tt.comma) {
          if (isPattern) {
            this.raise(this.start, "Comma is not permitted after the rest element")
          } else if (refDestructuringErrors && refDestructuringErrors.trailingComma < 0) {
            refDestructuringErrors.trailingComma = this.start
          }
        }
        return prop
      }

      return nextMethod.apply(this, arguments)
    })
    instance.extend("checkPropClash", nextMethod => function(prop, propHash) {
      if (prop.type == "SpreadElement" || prop.type == "RestElement") return
      return nextMethod.apply(this, arguments)
    })
    instance.extend("checkLVal", getCheckLVal)

    // This backports toAssignable from 5.3.0 to 5.2.x
    instance.extend("toAssignable", nextMethod => function(node, isBinding, refDestructuringErrors) {
      if (this.options.ecmaVersion >= 6 && node) {
        if (node.type == "ObjectExpression") {
          node.type = "ObjectPattern"
          if (refDestructuringErrors) this.checkPatternErrors(refDestructuringErrors, true)
          for (let prop of node.properties)
            this.toAssignable(prop, isBinding, refDestructuringErrors)
          return node
        } else if (node.type === "Property") {
          // AssignmentProperty has type == "Property"
          if (node.kind !== "init") this.raise(node.key.start, "Object pattern can't contain getter or setter")
          return this.toAssignable(node.value, isBinding, refDestructuringErrors)
        } else if (node.type === "SpreadElement") {
          node.type = "RestElement"
          this.toAssignable(node.argument, isBinding, refDestructuringErrors)
          if (node.argument.type === "AssignmentPattern")
            this.raise(node.argument.start, "Rest elements cannot have a default value")
          return
        }
      }
      return nextMethod.apply(this, arguments)
    })
    instance.extend("toAssignableList", nextMethod => function (exprList, isBinding) {
      const result = nextMethod.call(this, exprList, isBinding)
      if (exprList.length && exprList[exprList.length - 1] && exprList[exprList.length - 1].type === "RestElement") {
        // Backport check from 5.3.0
        if (exprList[exprList.length - 1].argument.type === "AssignmentPattern")
          this.raise(exprList[exprList.length - 1].argument.start, "Rest elements cannot have a default value")
      }
      return result
    })

    instance.extend("checkPatternExport", nextMethod => function(exports, pat) {
      if (pat.type == "ObjectPattern") {
        for (let prop of pat.properties)
          this.checkPatternExport(exports, prop)
        return
      } else if (pat.type === "Property") {
        return this.checkPatternExport(exports, pat.value)
      } else if (pat.type === "RestElement") {
        return this.checkPatternExport(exports, pat.argument)
      }
      nextMethod.apply(this, arguments)
    })
  };

  return acorn;
};
