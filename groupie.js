#!/usr/bin/env node
import chalk from 'chalk'
import figures from 'figures'
import jsonfile from 'jsonfile'
import WebSocket from 'ws'
import { format } from 'date-fns'
import { program } from 'commander'

const BINANCE = 'wss://fstream.binance.com/ws'

const store = {}

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
      log({ message: `${chalk[colorPrice](currency.format(candle.price))} ${chalk.gray(`[${chalk[colorClose](candle.priceClose.toFixed(2))}|${chalk[colorClose](candle.range.toFixed(1))}] [${chalk.yellow(candle.volumeBuy.toFixed(2))}/${chalk.yellow(candle.tickBuy)}=${chalk.cyan(volumeTickBuy.toFixed(2))}] [${chalk.yellow(candle.volumeSell.toFixed(2))}/${chalk.yellow(candle.tickSell)}=${chalk.magenta(volumeTickSell.toFixed(2))}] ${(volumeTickBuy / volumeTickSell).toFixed(2)}`)}`, type: 'info' })
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

const log = ({ message, type = '' }) => {
  console.log(`${logType(type)}${type !== '' ? `${chalk.gray(format(new Date(), 'EEE dd/MM HH:mm:ss'))} ` : ''}${message}`)
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

const start = () => {
  updateStore({ initialized: true })
  connect()
}

const updateStore = updates => {
  const { initialized } = store
  Object.keys(updates).forEach(key => {
    if (!initialized) {
      store[key] = updates[key]
    } else {
      switch (key) {
        case 'trade': {
          const { id, size } = store
          const { m: marketMaker, p: price, q: quantity, T: tradeTime } = updates[key]
          const trade = { marketMaker, price: parseFloat(price), quantity: parseFloat(quantity), tradeTime }
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
      const { description, version } = await jsonfile.readFile('./package.json')
      log({ message: `${chalk.cyan(description.replace('.', ''))} v${version}` })
      const currency = new Intl.NumberFormat('en-US', { currency: 'USD', minimumFractionDigits: 2, style: 'currency' })
      const size = parseInt(options.size ?? 60, 10)
      const webSocket = await createWebSocket()
      updateStore({ currency, size: size > 0 ? size * 1000 : 60 * 1000, symbol, timers: {}, trades: [], webSocket })
      start()
    } catch (error) {
      log({ message: error.toString(), type: 'error' })
      process.exit()
    }
  })
  .parse(process.argv)
