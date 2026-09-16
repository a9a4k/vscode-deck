const BRACKETED_PASTE_MODE = 2004;

type ScannerState = 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' | 'dcs' | 'dcs-escape';

export class BracketedPasteModeScanner {
  private enabled: boolean | undefined;
  private state: ScannerState = 'text';
  private isPrivateCsi = false;
  private parameterValue = 0;
  private parameterHasDigits = false;
  private parameterTooLarge = false;
  private includesBracketedPaste = false;
  private isValidModeSequence = true;

  accept(output: string): boolean | undefined {
    for (const character of output) this.acceptCharacter(character);
    return this.enabled;
  }

  private acceptCharacter(character: string): void {
    switch (this.state) {
      case 'text':
        if (character === '\x1b') this.state = 'escape';
        return;
      case 'escape':
        this.acceptEscape(character);
        return;
      case 'csi':
        this.acceptCsi(character);
        return;
      case 'osc':
        if (character === '\x07') this.state = 'text';
        else if (character === '\x1b') this.state = 'osc-escape';
        return;
      case 'dcs':
        if (character === '\x1b') this.state = 'dcs-escape';
        return;
      case 'osc-escape':
      case 'dcs-escape':
        if (character === '\\') this.state = 'text';
        else this.acceptEscape(character);
        return;
    }
  }

  private acceptEscape(character: string): void {
    if (character === '\x1b') return;
    if (character === '[') {
      this.beginCsi();
      return;
    }
    if (character === ']') {
      this.state = 'osc';
      return;
    }
    if (character === 'P') {
      this.state = 'dcs';
      return;
    }
    if (character === 'c') this.enabled = false;
    this.state = 'text';
  }

  private beginCsi(): void {
    this.state = 'csi';
    this.isPrivateCsi = false;
    this.resetParameter();
    this.includesBracketedPaste = false;
    this.isValidModeSequence = true;
  }

  private acceptCsi(character: string): void {
    if (character === '\x1b') {
      this.state = 'escape';
      return;
    }
    if (character === '?' && !this.parameterHasDigits && !this.isPrivateCsi) {
      this.isPrivateCsi = true;
      return;
    }
    if (character >= '0' && character <= '9') {
      this.parameterHasDigits = true;
      if (!this.parameterTooLarge) {
        this.parameterValue = (this.parameterValue * 10) + Number(character);
        this.parameterTooLarge = this.parameterValue > BRACKETED_PASTE_MODE;
      }
      return;
    }
    if (character === ';') {
      this.finishParameter();
      return;
    }
    if (character === 'h' || character === 'l') {
      this.finishParameter();
      if (this.isPrivateCsi && this.includesBracketedPaste && this.isValidModeSequence) {
        this.enabled = character === 'h';
      }
    }
    if (character >= '@' && character <= '~') this.state = 'text';
    else this.isValidModeSequence = false;
  }

  private finishParameter(): void {
    if (this.parameterHasDigits && !this.parameterTooLarge && this.parameterValue === BRACKETED_PASTE_MODE) {
      this.includesBracketedPaste = true;
    }
    this.resetParameter();
  }

  private resetParameter(): void {
    this.parameterValue = 0;
    this.parameterHasDigits = false;
    this.parameterTooLarge = false;
  }
}
