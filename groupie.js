#!/usr/bin/env node
import _ from 'lodash'
import blessed from 'blessed'
import cfonts from 'cfonts'
import chalk from 'chalk'
import contrib from 'blessed-contrib'
import figures from 'figures'
import jsonfile from 'jsonfile'
import WebSocket from 'ws'
import { exec } from 'child_process'
import { format } from 'date-fns'
import { program } from 'commander'

const BINANCE = 'wss://fstream.binance.com/ws'
const PLAY = { darwin: 'afplay <SOUND>', win32: '"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" --intf=null --play-and-exit <SOUND>' }

const store = {}

const addBox = type => {
  switch (type) {
    case 'display': {
      const { symbol } = store
      const priceBox = blessed.box({ height: 2, left: symbol.length * 4 + 1, style: { bg: 'black' }, top: 0 })
      const symbolBox = blessed.box({ height: 2, style: { bg: 'black' }, top: 0 })
      append({ box: symbolBox, type: 'symbol' })
      append({ box: priceBox, type: 'price' })
      break
    }
    case 'info': {
      const { screen } = store
      const box = blessed.box({ style: { bg: 'black' }, top: 2, width: screen.width })
      append({ box, type })
      break
    }
    case 'line': {
      const { screen } = store
      const box = contrib.line({ height: 20, style: { baseline: 'cyan', bg: 'black', text: 'black' }, top: screen.height - 18, wholeNumbersOnly: true, width: screen.width })
      append({ box, type })
      break
    }
  }
}

const append = ({ box, type }) => {
  const { boxes, screen } = store
  if (boxes[type]) {
    screen.remove(boxes[type])
  }
  screen.append(box)
  updateStore({ boxes: { ...boxes, [type]: box } })
}

const boomshakalaka = () => {
  const { currency, id, lastCandle, size, trades } = store
  if (trades.length > 0) {
    try {
      let max, min
      const { tickBuy, tickSell, volumeBuy, volumeSell } = trades.reduce(
        ({ tickBuy, tickSell, volumeBuy, volumeSell }, trade) => {
          if (!max && !min) {
            max = trade.price
            min = trade.price
          }
          if (trade.price > max) {
            max = trade.price
          }
          if (trade.price < min) {
            min = trade.price
          }
          tickBuy += !trade.marketMaker ? 1 : 0
          tickSell += trade.marketMaker ? 1 : 0
          volumeBuy += !trade.marketMaker ? trade.quantity : 0
          volumeSell += trade.marketMaker ? trade.quantity : 0
          return { tickBuy, tickSell, volumeBuy, volumeSell }
        },
        { tickBuy: 0, tickSell: 0, volumeBuy: 0, volumeSell: 0 }
      )
      const candle = {
        id,
        price: trades[trades.length - 1].price,
        priceClose: max === min ? -1 : (trades[trades.length - 1].price - min) / (max - min),
        range: max - min,
        tickBuy,
        tickSell,
        time: id * size,
        volumeBuy,
        volumeSell
      }
      let colorPrice = 'yellow'
      if (lastCandle && candle.price > lastCandle.price) {
        colorPrice = 'green'
      } else if (lastCandle && candle.price < lastCandle.price) {
        colorPrice = 'red'
      }
      let colorClose = 'red'
      if (candle.priceClose >= 0.8) {
        colorClose = 'green'
      } else if (candle.priceClose >= 0.5) {
        colorClose = 'yellow'
      } else if (candle.priceClose >= 0.2) {
        colorClose = 'magenta'
      }
      const volumeTickBuy = candle.volumeBuy / candle.tickBuy
      const volumeTickSell = candle.volumeSell / candle.tickSell
      const polarvol = (volumeTickBuy - volumeTickSell) * (candle.tickBuy + candle.tickSell)
      log({ message: `${chalk[colorPrice](currency.format(candle.price))} ${chalk.white(`[${chalk[colorClose](candle.priceClose.toFixed(2))}|${chalk[colorClose](candle.range.toFixed(1))}] [${chalk.yellow(candle.volumeBuy.toFixed(2))}/${chalk.yellow(candle.tickBuy)}=${chalk.cyan(volumeTickBuy.toFixed(2))}] [${chalk.yellow(candle.volumeSell.toFixed(2))}/${chalk.yellow(candle.tickSell)}=${chalk.magenta(volumeTickSell.toFixed(2))}] ${chalk.gray(polarvol.toFixed(2))}`)}`, type: 'info' })
      updateStore({ lastCandle: candle })
    } catch (error) {
      log({ message: error.toString(), type: 'error' })
    }
  }
}

const connect = () => {
  const { symbol, timers, webSocket } = store
  timers.list && clearInterval(timers.list)
  webSocket.send(JSON.stringify({ method: 'SUBSCRIBE', params: [`${symbol.toLowerCase()}@aggTrade`] }))
  log({ message: 'socket connected', type: 'success' })
  timers.list = setInterval(() => {
    const { webSocket } = store
    webSocket.send(JSON.stringify({ id: 1337, method: 'LIST_SUBSCRIPTIONS' }))
  }, 25000)
  resetWatchdog()
}

const createWebSocket = () =>
  new Promise((resolve, reject) => {
    const webSocket = new WebSocket(BINANCE)
    webSocket.on('error', error => reject(error))
    webSocket.on('message', message => {
      const { e, ...rest } = JSON.parse(message)
      switch (e) {
        case 'aggTrade': {
          updateStore({ trade: rest })
          break
        }
        default: {
          if (rest.id === 1337 && rest.result.length === 1) {
            resetWatchdog()
          }
        }
      }
    })
    webSocket.on('open', () => resolve(webSocket))
  })

const draw = () => {
  const { boxes, currency, directionColor, lastTrade, lineData, messages, screen, symbol } = store
  if (lastTrade) {
    const symbolRender = cfonts.render(symbol, { colors: ['yellow'], font: 'tiny', space: false })
    boxes.symbol.setContent(symbolRender.string)
    const priceRender = cfonts.render(currency.format(lastTrade.price), { colors: [directionColor], font: 'tiny', space: false })
    boxes.price.setContent(priceRender.string)
  }
  boxes.info.setContent(messages.map(message => ` ${message}`).join('\n'))
  if (lineData.x.length > 1) {
    boxes.line.setData([{ style: { line: 'yellow' }, title: 'Ticks', x: lineData.x, y: lineData.y }])
  }
  screen.render()
}

const log = ({ message, type = '' }) => {
  updateStore({ message: `${logType(type)}${type !== '' ? `${chalk.white(format(new Date(), 'EEE dd/MM HH:mm:ss'))} ` : ''}${message}` })
}

const logType = type => {
  switch (type) {
    case 'error':
      return `${chalk.red(figures.cross)} `
    case 'info':
      return `${chalk.blue(figures.bullet)} `
    case 'success':
      return `${chalk.green(figures.tick)} `
    case 'warning':
      return `${chalk.yellow(figures.warning)} `
    default:
      return ''
  }
}

const play = sound => {
  PLAY[process.platform] && exec(PLAY[process.platform].replace('<SOUND>', `mp3/${sound}.mp3`))
}

const resetWatchdog = () => {
  const { timers } = store
  timers.reconnect && clearTimeout(timers.reconnect)
  timers.reconnect = setTimeout(async () => {
    log({ message: 'disconnected, attempting to reconnect...', type: 'warning' })
    try {
      const webSocket = await createWebSocket()
      updateStore({ webSocket })
    } catch (error) {
      resetWatchdog()
    }
  }, 60000)
}

const setAlert = () => {
  const { screen, size } = store
  const $ = blessed.box({ content: '$', height: 1, left: 50 + `${size}`.length, parent: screen, style: { bg: 'blue' }, top: 2, width: 1 })
  const input = blessed.textbox({ height: 1, inputOnFocus: true, left: 51 + `${size}`.length, parent: screen, style: { bg: 'blue' }, top: 2, width: 11 })
  input.on('cancel', () => {
    $.destroy()
    input.destroy()
  })
  input.on('submit', () => {
    const alert = parseFloat(input.getValue().replace(',', '.'))
    updateStore({ alert: alert > 0 ? alert : 0 })
    $.destroy()
    input.destroy()
  })
  input.focus()
}

const start = title => {
  const { screen } = store
  addBox('display')
  addBox('info')
  addBox('line')
  screen.key('a', setAlert)
  screen.key('q', process.exit)
  screen.on(
    'resize',
    _.debounce(() => {
      addBox('display')
      addBox('info')
      addBox('line')
    }, 500)
  )
  screen.title = title
  updateStore({ initialized: true })
  connect()
  setInterval(draw, 50)
}

const updateStore = updates => {
  const { initialized } = store
  Object.keys(updates).forEach(key => {
    if (!initialized) {
      store[key] = updates[key]
    } else {
      switch (key) {
        case 'alert': {
          const { currency, header, lastTrade } = store
          if (lastTrade) {
            const alert = updates[key]
            if (alert > 0) {
              store.alert = alert
              store.messages[0] = `${header} ${chalk[alert > lastTrade.price ? 'cyan' : 'magenta'](currency.format(updates[key]))}`
            } else {
              delete store.alert
              store.messages[0] = `${header}`
            }
          }
          break
        }
        case 'lastCandle': {
          const y = store.lineData.y.slice()
          y.push(updates[key].tickBuy + updates[key].tickSell)
          while (y.length > 100) {
            y.shift()
          }
          const min = Math.min(...y)
          store.lineData.y = y.map(value => value - min)
          store.lineData.x = [...Array(store.lineData.y.length).keys()]
          store.lastCandle = updates[key]
          break
        }
        case 'message': {
          const { messages } = store
          store.messages = [messages[0], updates[key], ...messages.slice(1, 100)]
          break
        }
        case 'trade': {
          const { alert, directionColor, id, lastTrade, size } = store
          const { m: marketMaker, p: price, q: quantity, T: tradeTime } = updates[key]
          const trade = { marketMaker, price: parseFloat(price), quantity: parseFloat(quantity), tradeTime }
          if (alert && lastTrade) {
            if ((lastTrade.price < alert && trade.price >= alert) || (lastTrade.price > alert && trade.price <= alert)) {
              play('alert')
              updateStore({ alert: 0 })
            }
          }
          const newId = Math.floor(trade.tradeTime / size)
          if (!id) {
            store.id = `${newId}`
          } else if (typeof id === 'string' && newId > parseInt(id, 10)) {
            store.id = newId
            store.trades = []
          } else if (newId > id) {
            boomshakalaka()
            store.id = newId
            store.trades = []
          }
          updateStore({ directionColor: trade.price > lastTrade?.price ? 'green' : trade.price < lastTrade?.price ? 'red' : directionColor ?? 'white', lastTrade: trade })
          store.trades.push(trade)
          break
        }
        case 'webSocket': {
          const { id, webSocket } = store
          id && delete store.id
          webSocket && webSocket.terminate()
          store.webSocket = updates[key]
          connect()
          break
        }
        default: {
          store[key] = updates[key]
        }
      }
    }
  })
}

program
  .argument('<symbol>', 'symbol')
  .option('-s, --size <seconds>', 'candle size in seconds (defaults to 60)')
  .action(async (symbol, options) => {
    try {
      const { description, name, version } = await jsonfile.readFile('./package.json')
      const currency = new Intl.NumberFormat('en-US', { currency: 'USD', minimumFractionDigits: 2, style: 'currency' })
      const screen = blessed.screen({ forceUnicode: true, fullUnicode: true, smartCSR: true })
      const size = parseInt(options.size ?? 60, 10) > 0 ? parseInt(options.size ?? 60, 10) : 60
      const header = chalk.white(`${chalk.green(description.replace('.', ''))} v${version} - ${chalk.cyan('a')}lert ${chalk.cyan('q')}uit ${chalk.yellow(`${size}s`)}`)
      const webSocket = await createWebSocket()
      updateStore({
        boxes: {},
        currency,
        header,
        lineData: { x: [], y: [] },
        messages: [header],
        screen,
        size: size * 1000,
        symbol,
        timers: {},
        trades: [],
        webSocket
      })
      start(`${name.charAt(0).toUpperCase()}${name.slice(1)} v${version}`)
    } catch (error) {
      log({ message: error.toString(), type: 'error' })
      process.exit()
    }
  })
  .parse(process.argv)
