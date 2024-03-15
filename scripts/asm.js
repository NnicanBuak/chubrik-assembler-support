const {ARGS, OPERATORS, INSTRUCTIONS, REGISTERS, KEYWORDS, COMMANDS} = require("./constants")

class Command {
  constructor(instruction, args, opcode) {
      this.instruction = instruction;
      this.args = args;
      this.opcode = opcode;
  }

  match(instruction, args) {
      const argc = this.args.length;
      let match = this.instruction === instruction && argc === args.length;
      if (match)
          for (let i = 0; i < argc; ++i) {
              const argType = this.args[i];
              const { type, value } = args[i];
              if (argType !== type && !(argType === ARGS.ZERO && value === 0)) {
                  match = false;
                  break;
              }
          }
      return match;
  }
}

class Token {
  static INSTRUCTION = 0x0;
  static NUMBER = 0x1;
  static NAME = 0x2;
  static CHAR = 0x3;
  static REGISTER = 0x4;
  static EOF = 0x5;
  static KEYWORD = 0x6;
  static OPERATOR = 0x7;

  constructor(type, value, position) {
      this.type = type;
      this.value = value;
      this.position = position;
  }

  toString() {
      return this.type === Token.EOF ? "<eof>" : `'${this.value}'`;
  }
}

const whitespace = /^[ \r]$/;
const digit = /^[0-9]$/;
const letter = /^[a-z]$/i;

class Tokenizer {
  line = 0;
  column = 0;
  offset = 0;

  constructor(source) {
      this.source = source;
  }

  get position() {
      return [this.line, this.column];
  }

  peekch() {
      return this.source[this.offset];
  }

  consume() {
      if (this.peekch() === "\n") {
          ++this.line;
          this.column = 0;
      } else
          ++this.column;
      ++this.offset;
  }

  lookahead(skipNewline=true) {
      const { offset, line, column } = this;
      const token = this.next(skipNewline);
      this.offset = offset;
      this.line = line;
      this.column = column;
      return token;
  }

  next(skipNewline=true) {
      while (whitespace.test(this.peekch()) || (skipNewline && this.peekch() === "\n") || this.peekch() === ";") {
          while (whitespace.test(this.peekch()) || (skipNewline && this.peekch() === "\n"))
              this.consume();

          while (this.peekch() === ";") {
              this.consume();
              while (this.peekch() !== "\n" && this.peekch() != null)
                  this.consume();
          }
      }

      let ch = this.peekch();
      if (ch == null)
          return new Token(Token.EOF, null, this.position);
      else if (letter.test(ch) || ch === "_")
          return this.readName();
      else if (digit.test(ch))
          return this.readNumber();
      else {
          const { position } = this;
          this.consume();
          return new Token(OPERATORS.includes(ch) ? Token.OPERATOR : Token.CHAR, ch, position);
      }
  }

  readName() {
      const { position } = this;

      let name = "";

      let ch;
      while (letter.test(ch = this.peekch()) || digit.test(ch) || ch === "_") {
          this.consume();
          name += ch;
      }

      let type = Token.NAME;
      if (INSTRUCTIONS.includes(name))
          type = Token.INSTRUCTION;
      else if (REGISTERS.includes(name))
          type = Token.REGISTER;
      else if (KEYWORDS.includes(name))
          type = Token.KEYWORD;
      return new Token(type, name, position);
  }

  readNumber() {
      const { position } = this;

      let number = "";

      let ch;
      while (digit.test(ch = this.peekch())) {
          this.consume();
          number += ch;
      }
      while (letter.test(ch = this.peekch()) || digit.test(ch)) {
          this.consume();
          number += ch;
      }

      return new Token(Token.NUMBER, number, position);
  }
}

class AsmError {
  constructor(position, message) {
      this.position = position;
      this.message = message;
  }
}

class RefExpression {
  values = [];
  operations = [];
  canResolve = false;

  constructor(resolveCallback) {
      this.resolveCallback = resolveCallback;
  }

  tryResolve() {
      if (this.canResolve && this.values.every((value) => value != null))
          this.resolveCallback(this.values.reduce((a, b, index) => {
              if (a == null)
                  return b;
              switch (this.operations[index - 1]) {
                  case "+":
                      return a + b;
                  case "-":
                      return a - b;
              }
          }, null));
  }

  makeResolveCallback() {
      const index = this.values.length;
      this.values.push(null);
      return (value) => {
          this.values[index] = value;
          this.tryResolve();
      };
  }

  set = this.makeResolveCallback();

  add() {
      this.operations.push("+");
      return this.makeResolveCallback();
  }

  sub() {
      this.operations.push("-");
      return this.makeResolveCallback();
  }

  done() {
      this.canResolve = true;
      this.tryResolve();
  }
}

class Compiler {
  bytes = [];
  errors = [];
  refs = [];
  names = {};

  constructor(source) {
    this.commands = COMMANDS.map((command) => new Command(...command));
    this.tokenizer = new Tokenizer(source);
  }

  parseArgs() {
      const args = [];
      let token;
      if ((token = this.tokenizer.lookahead(false)).type !== Token.CHAR || token.value !== "\n")
          if (this.parseArg(args, false)) {
              let i = 0;
              while ((token = this.tokenizer.lookahead()).type === Token.CHAR && token.value === ",") {
                  this.tokenizer.next();
                  if (!this.parseArg(args, true))
                      return null;
                  ++i;
              }
          } else
              return [];
      return args;
  }

  parseArg(args, required=false) {
      const token = this.tokenizer.lookahead();
      const arg = { position: token.position };
      if (token.type === Token.REGISTER) {
          this.tokenizer.next();
          arg.type = ARGS.A + REGISTERS.indexOf(token.value);
      } else if (this.parseExpression((value) => {
          arg.value = value;
          arg.resolveCallback?.(value);
      }, false))
          arg.type = ARGS.BYTE;
      else {
          if (required)
              this.errors.push(new AsmError(token.position, `unexpected ${token}`));
          return false;
      }
      args.push(arg);
      return true;
  }

  parseValue(resolveCallback, required=false) {
      let token = this.tokenizer.lookahead();
      if (token.type === Token.NAME) {
          const value = this.names[token.value];
          if (value != null)
              resolveCallback(value);
          else
              this.refs.push({ name: token.value, resolveCallback, position: token.position });
      } else if (token.type === Token.NUMBER)
          resolveCallback(this.parseNumber(token));
      else if (token.type === Token.CHAR && token.value === "$")
          resolveCallback(this.bytes.length);
      else {
          if (required)
              this.errors.push(new AsmError(token.position, `unexpected ${token}`));
          return false;
      }
      this.tokenizer.next();
      return true;
  }

  parseNumber(token) {
      try {
          if (token.value[0] === "0" && token.value.length > 1)
              if (token.value.length === 2)
                  return parseInt(token.value.slice(1), 8);
              else
                  switch (token.value[1].toLowerCase()) {
                      case "x":
                          return parseInt(token.value.slice(2), 16);
                      case "b":
                          return parseInt(token.value.slice(2), 2);
                  }
          return parseInt(token.value);
      } catch {
          this.errors.push(new AsmError(token.position, `invalid number ${token.value}`));
      }
  }

  parseExpression(resolveCallback, required=false) {
      const ref = new RefExpression(resolveCallback);

      if (this.parseValue(ref.set, required)) {
          let token;
          while ((token = this.tokenizer.lookahead()).type === Token.OPERATOR) {
              this.tokenizer.next();
              switch (token.value) {
                  case "+":
                      if (!this.parseValue(ref.add(), required))
                          return false;
                      break;
                  case "-":
                      if (!this.parseValue(ref.sub(), required))
                          return false;
                      break;
              }
          }
          ref.done();
          return true;
      }
      return false;
  }

  resolveReference(name, value) {
      this.names[name] = value;

      for (let i = 0; i < this.refs.length; ++i) {
          const ref = this.refs[i];
          if (ref.name === name) {
              ref.resolveCallback(value);
              this.refs.splice(i--, 1);
          }
      }
  }

  compile() {
      const names = {};

      let token;
      while ((token = this.tokenizer.next()).type !== Token.EOF)
          if (token.type === Token.INSTRUCTION) {
              const instruction = token.value;
              const { position } = token;

              const args = this.parseArgs();
              if (args == null)
                  continue;

              let opcode, argTypes;
              for (const command of this.commands)
                  if (command.match(instruction, args)) {
                      opcode = command.opcode;
                      argTypes = command.args;
                      break;
                  }

              if (opcode == null) {
                  this.errors.push(new AsmError(position, "unknown command"));
                  continue;
              }

              this.bytes.push(opcode);

              const argc = args.length;
              for (let i = 0; i < argc; ++i) {
                  const arg = args[i];
                  if (argTypes[i] === ARGS.BYTE)
                      if (arg.value)
                          this.bytes.push(arg.value & 0xFF);
                      else {
                          const offset = this.bytes.length;
                          this.bytes.push(0x00);
                          arg.resolveCallback = (value) => this.bytes[offset] = value & 0xFF;
                      }
              }
          } else if (token.type === Token.NAME) {
              const name = token.value;
              const { position } = token;

              token = this.tokenizer.next();

              if (token.type === Token.KEYWORD && token.value === "db") {
                  this.resolveReference(name, this.bytes.length);
                  do {
                      const offset = this.bytes.length;
                      this.bytes.push(0x00);
                      this.parseExpression((value) => this.bytes[offset] = value, true);
                  } while ((token = this.tokenizer.lookahead()).type === Token.CHAR && token.value === "," && this.tokenizer.next())
              } else if (token.type === Token.KEYWORD && token.value === "equ")
                  this.parseExpression((value) => this.resolveReference(name, value), true);
              else if (token.type === Token.CHAR && token.value === ":")
                  this.resolveReference(name, this.bytes.length);
              else {
                  this.errors.push(new AsmError(token.position, `unexpected ${token}`));
                  continue;
              }

              if (name in names) {
                  this.errors.push(new AsmError(position, `label ${name} is already defined`));
                  continue;
              }
          } else
              this.errors.push(new AsmError(token.position, `unexpected ${token}`));

      for (const { name, position } of this.refs)
          this.errors.push(new AsmError(position, `unresolved ${name}`));

      if (this.bytes.length > 256)
          this.errors.push(new AsmError([0, 0], "memory overflow"));
  }
}

module.exports = {
    Compiler
}