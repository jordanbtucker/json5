import * as util from './util'

type JSON5Value =
  | boolean
  | null
  | number
  | string
  | JSON5Value[]
  | {[key: string]: JSON5Value}

type TokenType =
  | 'boolean'
  | 'eof'
  | 'identifier'
  | 'null'
  | 'numeric'
  | 'punctuator'
  | 'string'

type TokenValue = string | number | boolean | null

type Token = {
  type: TokenType
  value?: TokenValue
  line: number
  column: number
}

interface JSON5SyntaxError extends SyntaxError {
  lineNumber: number
  columnNumber: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Parses a JSON5 string, constructing the JavaScript value or object described
 * by the string.
 * @template T The type of the return value.
 * @param text The string to parse as JSON5.
 * @param reviver A function that prescribes how the value originally produced
 * by parsing is transformed before being returned.
 * @returns The JavaScript value converted from the JSON5 string.
 */
export default function parse<T = any>(
  text: string,
  reviver?: ((this: any, key: string, value: any) => any) | null,
): T {
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const source = String(text)
  const stack: JSON5Value[] = []
  let parseState: keyof typeof parseStates = 'start'
  let pos = 0
  let line = 1
  let column = 0
  let token: Token | undefined
  let key: PropertyKey | undefined
  let root: JSON5Value | undefined
  let lexState: keyof typeof lexStates | keyof typeof parseStates = 'default'
  let buffer: string | undefined = ''
  let doubleQuote = false
  let sign = 1
  let c: string | undefined

  function internalize(
    holder: {[key: string | number]: JSON5Value},
    name: string,
    reviver: (this: unknown, key: string, value: unknown) => unknown,
  ): unknown {
    const value = holder[name]
    if (value != null && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const key = String(i)
          const replacement = internalize(
            value as {[key: number]: JSON5Value},
            key,
            reviver,
          )
          if (replacement === undefined) {
            delete value[key as unknown as number]
          } else {
            Object.defineProperty(value, key, {
              value: replacement,
              writable: true,
              enumerable: true,
              configurable: true,
            })
          }
        }
      } else {
        for (const key in value) {
          const replacement = internalize(value, key, reviver)
          if (replacement === undefined) {
            delete value[key]
          } else {
            Object.defineProperty(value, key, {
              value: replacement,
              writable: true,
              enumerable: true,
              configurable: true,
            })
          }
        }
      }
    }

    return reviver.call(holder, name, value)
  }

  function lex(): Token {
    lexState = 'default'
    buffer = ''
    doubleQuote = false
    sign = 1

    for (;;) {
      c = peek()

      // This code is unreachable.
      // if (!lexStates[lexState]) {
      //     throw invalidLexState(lexState)
      // }

      const token = lexStates[lexState]()
      if (token) {
        return token
      }
    }
  }

  function peek(): string | undefined {
    if (source[pos]) {
      return String.fromCodePoint(source.codePointAt(pos) as number)
    }
  }

  function read(): string | undefined {
    const c = peek()

    if (c === '\n') {
      line++
      column = 0
    } else if (c) {
      column += c.length
    } else {
      column++
    }

    if (c) {
      pos += c.length
    }

    return c
  }

  const lexStates = {
    default(): Token | void {
      switch (c) {
        case '\t':
        case '\v':
        case '\f':
        case ' ':
        case '\u00A0':
        case '\uFEFF':
        case '\n':
        case '\r':
        case '\u2028':
        case '\u2029':
          read()
          return

        case '/':
          read()
          lexState = 'comment'
          return

        case undefined:
          read()
          return newToken('eof')
      }

      if (util.isSpaceSeparator(c)) {
        read()
        return
      }

      // This code is unreachable.
      // if (!lexStates[parseState]) {
      //     throw invalidLexState(parseState)
      // }

      return lexStates[parseState]()
    },

    comment(): void {
      switch (c) {
        case '*':
          read()
          lexState = 'multiLineComment'
          return

        case '/':
          read()
          lexState = 'singleLineComment'
          return
      }

      throw invalidChar(read())
    },

    multiLineComment(): void {
      switch (c) {
        case '*':
          read()
          lexState = 'multiLineCommentAsterisk'
          return

        case undefined:
          throw invalidChar(read())
      }

      read()
    },

    multiLineCommentAsterisk(): void {
      switch (c) {
        case '*':
          read()
          return

        case '/':
          read()
          lexState = 'default'
          return

        case undefined:
          throw invalidChar(read())
      }

      read()
      lexState = 'multiLineComment'
    },

    singleLineComment(): Token | undefined {
      switch (c) {
        case '\n':
        case '\r':
        case '\u2028':
        case '\u2029':
          read()
          lexState = 'default'
          return

        case undefined:
          read()
          return newToken('eof')
      }

      read()
    },

    value(): Token | undefined {
      switch (c) {
        case '{':
        case '[':
          return newToken('punctuator', read())

        case 'n':
          read()
          literal('ull')
          return newToken('null', null)

        case 't':
          read()
          literal('rue')
          return newToken('boolean', true)

        case 'f':
          read()
          literal('alse')
          return newToken('boolean', false)

        case '-':
        case '+':
          if (read() === '-') {
            sign = -1
          }

          lexState = 'sign'
          return

        case '.':
          buffer = read()
          lexState = 'decimalPointLeading'
          return

        case '0':
          buffer = read()
          lexState = 'zero'
          return

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          buffer = read()
          lexState = 'decimalInteger'
          return

        case 'I':
          read()
          literal('nfinity')
          return newToken('numeric', Infinity)

        case 'N':
          read()
          literal('aN')
          return newToken('numeric', NaN)

        case '"':
        case "'":
          doubleQuote = read() === '"'
          buffer = ''
          lexState = 'string'
          return
      }

      throw invalidChar(read())
    },

    identifierNameStartEscape(): void {
      if (c !== 'u') {
        throw invalidChar(read())
      }

      read()
      const u = unicodeEscape()
      switch (u) {
        case '$':
        case '_':
          break

        default:
          if (!util.isIdStartChar(u)) {
            throw invalidIdentifier()
          }

          break
      }

      buffer += u
      lexState = 'identifierName'
    },

    identifierName(): Token | undefined {
      switch (c) {
        case '$':
        case '_':
        case '\u200C':
        case '\u200D':
          buffer += read() as string
          return

        case '\\':
          read()
          lexState = 'identifierNameEscape'
          return
      }

      if (util.isIdContinueChar(c)) {
        buffer += read() as string
        return
      }

      return newToken('identifier', buffer)
    },

    identifierNameEscape(): void {
      if (c !== 'u') {
        throw invalidChar(read())
      }

      read()
      const u = unicodeEscape()
      switch (u) {
        case '$':
        case '_':
        case '\u200C':
        case '\u200D':
          break

        default:
          if (!util.isIdContinueChar(u)) {
            throw invalidIdentifier()
          }

          break
      }

      buffer += u
      lexState = 'identifierName'
    },

    sign(): Token | undefined {
      switch (c) {
        case '.':
          buffer = read()
          lexState = 'decimalPointLeading'
          return

        case '0':
          buffer = read()
          lexState = 'zero'
          return

        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          buffer = read()
          lexState = 'decimalInteger'
          return

        case 'I':
          read()
          literal('nfinity')
          return newToken('numeric', sign * Infinity)

        case 'N':
          read()
          literal('aN')
          return newToken('numeric', NaN)
      }

      throw invalidChar(read())
    },

    zero(): Token | undefined {
      switch (c) {
        case '.':
          buffer += read() as string
          lexState = 'decimalPoint'
          return

        case 'e':
        case 'E':
          buffer += read() as string
          lexState = 'decimalExponent'
          return

        case 'x':
        case 'X':
          buffer += read() as string
          lexState = 'hexadecimal'
          return
      }

      return newToken('numeric', sign * 0)
    },

    decimalInteger(): Token | undefined {
      switch (c) {
        case '.':
          buffer += read() as string
          lexState = 'decimalPoint'
          return

        case 'e':
        case 'E':
          buffer += read() as string
          lexState = 'decimalExponent'
          return
      }

      if (util.isDigit(c)) {
        buffer += read() as string
        return
      }

      return newToken('numeric', sign * Number(buffer))
    },

    decimalPointLeading(): void {
      if (util.isDigit(c)) {
        buffer += read() as string
        lexState = 'decimalFraction'
        return
      }

      throw invalidChar(read())
    },

    decimalPoint(): Token | undefined {
      switch (c) {
        case 'e':
        case 'E':
          buffer += read() as string
          lexState = 'decimalExponent'
          return
      }

      if (util.isDigit(c)) {
        buffer += read() as string
        lexState = 'decimalFraction'
        return
      }

      return newToken('numeric', sign * Number(buffer))
    },

    decimalFraction(): Token | undefined {
      switch (c) {
        case 'e':
        case 'E':
          buffer += read() as string
          lexState = 'decimalExponent'
          return
      }

      if (util.isDigit(c)) {
        buffer += read() as string
        return
      }

      return newToken('numeric', sign * Number(buffer))
    },

    decimalExponent(): void {
      switch (c) {
        case '+':
        case '-':
          buffer += read() as string
          lexState = 'decimalExponentSign'
          return
      }

      if (util.isDigit(c)) {
        buffer += read() as string
        lexState = 'decimalExponentInteger'
        return
      }

      throw invalidChar(read())
    },

    decimalExponentSign(): void {
      if (util.isDigit(c)) {
        buffer += read() as string
        lexState = 'decimalExponentInteger'
        return
      }

      throw invalidChar(read())
    },

    decimalExponentInteger(): Token | undefined {
      if (util.isDigit(c)) {
        buffer += read() as string
        return
      }

      return newToken('numeric', sign * Number(buffer))
    },

    hexadecimal(): void {
      if (util.isHexDigit(c)) {
        buffer += read() as string
        lexState = 'hexadecimalInteger'
        return
      }

      throw invalidChar(read())
    },

    hexadecimalInteger(): Token | undefined {
      if (util.isHexDigit(c)) {
        buffer += read() as string
        return
      }

      return newToken('numeric', sign * Number(buffer))
    },

    string(): Token | undefined {
      switch (c) {
        case '\\':
          read()
          buffer += escape()
          return

        case '"':
          if (doubleQuote) {
            read()
            return newToken('string', buffer)
          }

          buffer += read() as string
          return

        case "'":
          if (!doubleQuote) {
            read()
            return newToken('string', buffer)
          }

          buffer += read() as string
          return

        case '\n':
        case '\r':
          throw invalidChar(read())

        case undefined:
          throw invalidChar(read())
      }

      buffer += read() as string
    },

    start(): Token | undefined {
      switch (c) {
        case '{':
        case '[':
          return newToken('punctuator', read())

        // This code is unreachable since the default lexState handles eof.
        // case undefined:
        //     return newToken('eof')
      }

      lexState = 'value'
    },

    beforePropertyName(): Token | undefined {
      switch (c) {
        case '$':
        case '_':
          buffer = read()
          lexState = 'identifierName'
          return

        case '\\':
          read()
          lexState = 'identifierNameStartEscape'
          return

        case '}':
          return newToken('punctuator', read())

        case '"':
        case "'":
          doubleQuote = read() === '"'
          lexState = 'string'
          return
      }

      if (util.isIdStartChar(c)) {
        buffer += read() as string
        lexState = 'identifierName'
        return
      }

      throw invalidChar(read())
    },

    afterPropertyName(): Token {
      if (c === ':') {
        return newToken('punctuator', read())
      }

      throw invalidChar(read())
    },

    beforePropertyValue(): void {
      lexState = 'value'
    },

    afterPropertyValue(): Token {
      switch (c) {
        case ',':
        case '}':
          return newToken('punctuator', read())
      }

      throw invalidChar(read())
    },

    beforeArrayValue(): Token | undefined {
      if (c === ']') {
        return newToken('punctuator', read())
      }

      lexState = 'value'
    },

    afterArrayValue(): Token {
      switch (c) {
        case ',':
        case ']':
          return newToken('punctuator', read())
      }

      throw invalidChar(read())
    },

    end(): never {
      // This code is unreachable since it's handled by the default lexState.
      // if (c === undefined) {
      //     read()
      //     return newToken('eof')
      // }

      throw invalidChar(read())
    },
  }

  function newToken(type: TokenType, value?: TokenValue): Token {
    return {
      type,
      value,
      line,
      column,
    }
  }

  function literal(s: string): void {
    for (const c of s) {
      const p = peek()

      if (p !== c) {
        throw invalidChar(read())
      }

      read()
    }
  }

  function escape(): string {
    const c = peek()
    switch (c) {
      case 'b':
        read()
        return '\b'

      case 'f':
        read()
        return '\f'

      case 'n':
        read()
        return '\n'

      case 'r':
        read()
        return '\r'

      case 't':
        read()
        return '\t'

      case 'v':
        read()
        return '\v'

      case '0':
        read()
        if (util.isDigit(peek())) {
          throw invalidChar(read())
        }

        return '\0'

      case 'x':
        read()
        return hexEscape()

      case 'u':
        read()
        return unicodeEscape()

      case '\n':
      case '\u2028':
      case '\u2029':
        read()
        return ''

      case '\r':
        read()
        if (peek() === '\n') {
          read()
        }

        return ''

      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        throw invalidChar(read())

      case undefined:
        throw invalidChar(read())
    }

    return read() as string
  }

  function hexEscape(): string {
    let buffer = ''
    let c = peek()

    if (!util.isHexDigit(c)) {
      throw invalidChar(read())
    }

    buffer += read()

    c = peek()
    if (!util.isHexDigit(c)) {
      throw invalidChar(read())
    }

    buffer += read()

    return String.fromCodePoint(parseInt(buffer, 16))
  }

  function unicodeEscape(): string {
    let buffer = ''
    let count = 4

    while (count-- > 0) {
      const c = peek()
      if (!util.isHexDigit(c)) {
        throw invalidChar(read())
      }

      buffer += read()
    }

    return String.fromCodePoint(parseInt(buffer, 16))
  }

  const parseStates = {
    start(): void {
      if ((token as Token).type === 'eof') {
        throw invalidEOF()
      }

      push()
    },

    beforePropertyName(): void {
      switch ((token as Token).type) {
        case 'identifier':
        case 'string':
          key = (token as Token).value as string
          parseState = 'afterPropertyName'
          return

        case 'punctuator':
          // This code is unreachable since it's handled by the lexState.
          // if (token.value !== '}') {
          //     throw invalidToken()
          // }

          pop()
          return

        case 'eof':
          throw invalidEOF()
      }

      // This code is unreachable since it's handled by the lexState.
      // throw invalidToken()
    },

    afterPropertyName(): void {
      // This code is unreachable since it's handled by the lexState.
      // if (token.type !== 'punctuator' || token.value !== ':') {
      //     throw invalidToken()
      // }

      if ((token as Token).type === 'eof') {
        throw invalidEOF()
      }

      parseState = 'beforePropertyValue'
    },

    beforePropertyValue(): void {
      if ((token as Token).type === 'eof') {
        throw invalidEOF()
      }

      push()
    },

    beforeArrayValue(): void {
      if ((token as Token).type === 'eof') {
        throw invalidEOF()
      }

      if (
        (token as Token).type === 'punctuator' &&
        (token as Token).value === ']'
      ) {
        pop()
        return
      }

      push()
    },

    afterPropertyValue(): void {
      // This code is unreachable since it's handled by the lexState.
      // if (token.type !== 'punctuator') {
      //     throw invalidToken()
      // }

      if ((token as Token).type === 'eof') {
        throw invalidEOF()
      }

      switch ((token as Token).value) {
        case ',':
          parseState = 'beforePropertyName'
          return

        case '}':
          pop()
      }

      // This code is unreachable since it's handled by the lexState.
      // throw invalidToken()
    },

    afterArrayValue(): void {
      // This code is unreachable since it's handled by the lexState.
      // if (token.type !== 'punctuator') {
      //     throw invalidToken()
      // }

      if ((token as Token).type === 'eof') {
        throw invalidEOF()
      }

      switch ((token as Token).value) {
        case ',':
          parseState = 'beforeArrayValue'
          return

        case ']':
          pop()
      }

      // This code is unreachable since it's handled by the lexState.
      // throw invalidToken()
    },

    end(): void {
      // This code is unreachable since it's handled by the lexState.
      // if (token.type !== 'eof') {
      //     throw invalidToken()
      // }
    },
  }

  function push(): void {
    let value: JSON5Value = undefined as unknown as JSON5Value

    switch ((token as Token).type) {
      case 'punctuator':
        switch ((token as Token).value) {
          case '{':
            value = {}
            break

          case '[':
            value = []
            break
        }

        break

      case 'null':
      case 'boolean':
      case 'numeric':
      case 'string':
        value = (token as Token).value as TokenValue
        break

      // This code is unreachable.
      // default:
      //     throw invalidToken()
    }

    if (root === undefined) {
      root = value
    } else {
      const parent = stack[stack.length - 1]
      if (Array.isArray(parent)) {
        parent.push(value)
      } else {
        Object.defineProperty(parent, key as PropertyKey, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      }
    }

    if (value !== null && typeof value === 'object') {
      stack.push(value)

      if (Array.isArray(value)) {
        parseState = 'beforeArrayValue'
      } else {
        parseState = 'beforePropertyName'
      }
    } else {
      const current = stack[stack.length - 1]
      if (current == null) {
        parseState = 'end'
      } else if (Array.isArray(current)) {
        parseState = 'afterArrayValue'
      } else {
        parseState = 'afterPropertyValue'
      }
    }
  }

  function pop(): void {
    stack.pop()

    const current = stack[stack.length - 1]
    if (current == null) {
      parseState = 'end'
    } else if (Array.isArray(current)) {
      parseState = 'afterArrayValue'
    } else {
      parseState = 'afterPropertyValue'
    }
  }

  // This code is unreachable.
  // function invalidParseState () {
  //     return new Error(`JSON5: invalid parse state '${parseState}'`)
  // }

  // This code is unreachable.
  // function invalidLexState (state) {
  //     return new Error(`JSON5: invalid lex state '${state}'`)
  // }

  function invalidChar(c: string | undefined): JSON5SyntaxError {
    if (c === undefined) {
      return syntaxError(`JSON5: invalid end of input at ${line}:${column}`)
    }

    return syntaxError(
      `JSON5: invalid character '${formatChar(c)}' at ${line}:${column}`,
    )
  }

  function invalidEOF(): JSON5SyntaxError {
    return syntaxError(`JSON5: invalid end of input at ${line}:${column}`)
  }

  // This code is unreachable.
  // function invalidToken () {
  //     if (token.type === 'eof') {
  //         return syntaxError(`JSON5: invalid end of input at ${line}:${column}`)
  //     }

  //     const c = String.fromCodePoint(token.value.codePointAt(0))
  //     return syntaxError(`JSON5: invalid character '${formatChar(c)}' at ${line}:${column}`)
  // }

  function invalidIdentifier(): JSON5SyntaxError {
    column -= 5
    return syntaxError(
      `JSON5: invalid identifier character at ${line}:${column}`,
    )
  }

  function formatChar(c: string): string {
    const replacements: Record<string, string> = {
      "'": "\\'",
      '"': '\\"',
      '\\': '\\\\',
      '\b': '\\b',
      '\f': '\\f',
      '\n': '\\n',
      '\r': '\\r',
      '\t': '\\t',
      '\v': '\\v',
      '\0': '\\0',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029',
    }

    if (replacements[c]) {
      return replacements[c]
    }

    if (c < ' ') {
      const hexString = c.charCodeAt(0).toString(16)
      return '\\x' + ('00' + hexString).substring(hexString.length)
    }

    return c
  }

  function syntaxError(message: string): JSON5SyntaxError {
    const err = new SyntaxError(message) as JSON5SyntaxError
    err.lineNumber = line
    err.columnNumber = column
    return err
  }

  do {
    token = lex()

    // This code is unreachable.
    // if (!parseStates[parseState]) {
    //     throw invalidParseState()
    // }

    parseStates[parseState]()
  } while (token.type !== 'eof')

  if (typeof reviver === 'function') {
    return internalize({'': root as unknown as JSON5Value}, '', reviver) as T
  }

  return root as T
}
