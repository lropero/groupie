# Groupie 🔍

Binance grouped times & sales.

### Requires

- [Node v18.15.0](https://nodejs.org/)
- npm v9.6.2

### Installation

```sh
npm ci
```

### Usage

```sh
node groupie.js <SYMBOL> # e.g. 'node groupie.js BTCUSDT'
```

### Options

##### `-s` / `--size`

Candle size in seconds (defaults to 60)

```sh
node groupie.js <SYMBOL> -s 300 # 5m candles
```
