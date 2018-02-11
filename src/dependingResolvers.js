
import { push } from 'object-path'
import deepEqual from 'deep-equal'

import { nextTick, skip } from './utils'
import { allResolvers } from './allResolvers'
import { pipeResolvers } from './pipeResolvers'
import { combineResolvers } from './combineResolvers'
import { contextMustBeObject } from './miscResolvers'

function isPromise (obj) {
  return obj && (typeof obj === 'object' ||
      typeof obj === 'function') &&
    typeof obj.then === 'function'
}

/**
 * Piping resolver to save current value and reference to dependees cache.
 */
const saveDependee = combineResolvers(
  contextMustBeObject,
  (value, args, context, info) => ((
    push(context, '_dependees', { path: info.path, value }),
    value
  )),
)

/**
 * Identify a resolver as being a dependee, so other sibling
 * field resolvers might depend on the value resolved by this one.
 *
 * Basically, it will polute "info" during resolving
 * to insert the resolved value and path to this resolver.
 *
 * @param {Function} resolver Resolver implementation.
 * @return {Promise}.
 */
export const isDependee = resolver => {
  let cache = null
  return combineResolvers(
    pipeResolvers(
      (...args) => {
        if (cache) {
          return cache
        }
        const result = resolver(...args)
        if (!isPromise(result)) {
          return result
        }
        cache = result.then(res => {
          cache = null
          return res
        }).catch(err => {
          cache = null
          throw err
        })
        return cache
      },
      saveDependee
    )
  )
}

/**
 * Make sure the field name exists on the parent type.
 *
 * @param {String} dependeeName The name of the dependee to check the parent against
 * @return {Function} Resolver to error when no dependee is found.
 */
const dependeeExists = dependeeName =>
  (root, args, context, { fieldName, parentType: { _fields, name: parent } }) =>
    !_fields[dependeeName]
      ? new Error(`Cannot get dependee "${dependeeName}" from field "${fieldName}" on type "${parent}"`)
      : skip

/**
 * Resolver implementation to retrieve the resolved value of a dependee sibling field.
 *
 * @param {String} dependeeName The name of the dependee this resolver depends on.
 * @param {Function} resolver Resolver implemenatation.
 * @return {Function} dependee resolver.
 */
export const resolveDependee = dependeeName => combineResolvers(
  contextMustBeObject,
  dependeeExists(dependeeName),
  pipeResolvers(
    // Make sure dependent resolvers occur after
    // dependees have been initialized.
    nextTick,

    // Find any currently resolved dependee.
    (root, args, { _dependees = [] }, info) => _dependees
      .filter(({ path: { prev } }) => deepEqual(prev, info.path.prev))
      .find(({ path: { key } }) => key === dependeeName),

    // Run field resolution, in resolved value was not found.
    (resolved, args, context, info) => resolved === skip
      ? info.parentType._fields[dependeeName].resolve(info.rootValue, args, context, info)
      : resolved.value,
  ),
)

/**
 * Resolver implementation to retrieve the resolved value of a dependee sibling field.
 *
 * @param {[String]} dependeeNames Array of names of the dependees this resolver depends on.
 * @param {Function} resolver Resolver implemenatation.
 * @return {Function} dependee resolver.
 */
export const resolveDependees = dependeeNames => combineResolvers(
  contextMustBeObject,
  allResolvers(dependeeNames.map(resolveDependee)),
)
