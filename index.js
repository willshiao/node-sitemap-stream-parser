let request = require('request')
const sax = require('sax')
const async = require('async')
const zlib = require('zlib')
const urlParser = require('url')

const headers =
  { 'user-agent': process.env.USER_AGENT || 'node-sitemap-stream-parser' }
const agentOptions = {
  keepAlive: true,
  gzip: true
}
request = request.defaults({ headers, agentOptions, timeout: 60000 })

class SitemapParser {
  constructor (urlCb, sitemapCb) {
    this.parse = this.parse.bind(this)
    this.urlCb = urlCb
    this.sitemapCb = sitemapCb
    this.visited_sitemaps = {}
  }

  _download (url, parserStream, done) {
    if (url.lastIndexOf('.gz') === (url.length - 3)) {
      const unzip = zlib.createGzip()
      return request.get({ url, encoding: null }).pipe(unzip).pipe(parserStream)
    } else {
      const stream = request.get({ url, gzip: true })
      stream.on('error', err => {
        return done(err)
      })
      return stream.pipe(parserStream)
    }
  }

  parse (url, done) {
    let errored = false
    let isURLSet = false
    let isSitemapIndex = false
    let inLoc = false
    let lastMod = null
    let lastInfo = {}
    let inUrlTag = null

    this.visited_sitemaps[url] = true

    const parserStream = sax.createStream(false, { trim: true, normalize: true, lowercase: true })
    parserStream.on('opentag', node => {
      inLoc = node.name === 'loc'
      inUrlTag = node.name === 'url'
      lastMod = node.name === 'lastmod'
      if (node.name === 'urlset') { isURLSet = true }
      if (inUrlTag) {
        this.urlCb(lastInfo)
        lastInfo = {}
      }
      if (node.name === 'sitemapindex') { isSitemapIndex = true }
    })
    parserStream.on('closetag', tagName => {
      if (tagName === 'url') {
      }
    })
    parserStream.on('error', err => {
      errored = true
      return done(err)
    })
    parserStream.on('text', text => {
      if (isURLSet && lastMod) {
        lastInfo.lastMod = text
      } else if (inLoc) {
        text = urlParser.resolve(url, text)
        if (isURLSet) {
          lastInfo.text = text
          lastInfo.url = url
        } else if (isSitemapIndex) {
          if (this.visited_sitemaps[text] != null) {
            return console.error(`Already parsed sitemap: ${text}`)
          } else {
            return this.sitemapCb(text)
          }
        }
      }
    })
    parserStream.on('end', () => {
      if (!errored) return done(null)
    })

    return this._download(url, parserStream, done)
  }
}

exports.parseSitemap = function (url, urlCb, sitemapCb, done) {
  const parser = new SitemapParser(urlCb, sitemapCb)
  return parser.parse(url, done)
}

exports.parseSitemaps = function (urls, urlCb, sitemapTest, done) {
  if (!done) {
    done = sitemapTest
    sitemapTest = undefined
  }

  if (!(urls instanceof Array)) { urls = [urls] }

  const parser = new SitemapParser(urlCb, function (sitemap) {
    const shouldPush = sitemapTest ? sitemapTest(sitemap) : true
    if (shouldPush) { return queue.push(sitemap) }
  })

  var queue = async.queue(parser.parse, 4)
  queue.drain = () => done(null, Object.keys(parser.visited_sitemaps))
  return queue.push(urls)
};

exports.parseSitemapsPromise = (urls, urlCb, sitemapTest) => new Promise(resolve => exports.parseSitemaps(urls, urlCb, sitemapTest, resolve))

exports.sitemapsInRobots = (url, cb) => request.get(url, function (err, res, body) {
  if (err) { return cb(err) }
  if (res.statusCode !== 200) { return cb(`statusCode: ${res.statusCode}`) }
  const matches = []
  body.replace(/^Sitemap:\s?([^\s]+)$/igm, (m, p1) => matches.push(p1))
  return cb(null, matches)
})
