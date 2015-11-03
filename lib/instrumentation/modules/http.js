'use strict'

var shimmer = require('shimmer')
var asyncState = require('../../async-state')

var SERVER_FNS = ['on', 'addListener']

module.exports = function (http, agent) {
  agent.logger.trace('shimming http.Server.prototype functions:', SERVER_FNS)

  shimmer.massWrap(http.Server.prototype, SERVER_FNS, function (orig, name) {
    return function (event, listener) {
      if (event === 'request' && typeof listener === 'function') return orig.call(this, event, onRequest)
      else return orig.apply(this, arguments)

      function onRequest (req, res) {
        agent.logger.trace('intercepted call to http.Server.prototype.%s', name)

        var trans = agent.startTransaction(req.method + ' ' + req.url, 'web.http')
        asyncState.req = req
        asyncState.trans = req.__opbeat_trans = trans

        res.once('finish', function () {
          if (req.route && req.route.path) {
            trans._defaultName = req.method + ' ' + req.route.path
          }

          trans.result = res.statusCode
          agent.logger.trace('[%s] ending transaction', trans._uuid)
          trans.end()
        })

        listener.apply(this, arguments)
      }
    }
  })

  agent.logger.trace('shimming http.request function')

  shimmer.wrap(http, 'request', function (orig, name) {
    return function () {
      var trans = agent.trans()
      var uuid = trans ? trans._uuid : 'n/a'

      agent.logger.trace('[%s] intercepted call to http.request (transaction: %sactive)', uuid, trans ? '' : 'in')

      var req = orig.apply(this, arguments)
      if (!trans) return req
      if (req._headers.host === agent._apiHost) {
        agent.logger.trace('[%s] ignore http request to opbeat server', uuid)
        return req
      }

      var name = req.method + ' ' + req._headers.host
      var trace = trans.startTrace(name, 'ext.http.http')
      req.on('response', onresponse)

      return req

      function onresponse (res) {
        agent.logger.trace('[%s] intercepted http.ClientRequest response event', uuid)
        res.on('end', function () {
          agent.logger.trace('[%s] intercepted http.IncomingMessage end event', uuid)
          trace.end()
        })
      }
    }
  })

  return http
}