const vscode = require('vscode')
const { Compiler } = require("./scripts/asm");
const path = require('path');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	let disposable = vscode.commands.registerCommand(
		'chubrik_assembler_support.hexdump',
		function () {
			const activeEditor = vscode.window.activeTextEditor;
			const sourceCodePath = activeEditor.document.fileName

			if (!activeEditor) {
				vscode.window.showErrorMessage('Нет активного текстового редактора')
				return;
			}
			if (activeEditor.document.languageId !== 'asm') {
				vscode.window.showErrorMessage('Открытый файл не является файлом формата ASM');
				return;
			}

			const asmCode = activeEditor.document.getText();
			const compiler = new Compiler(asmCode);

			try {
				compiler.compile();

				if (compiler.errors.length > 0) {
					const compilerErrorMessage = `Compilation failed (${
						compiler.errors.length
					} error${
						compiler.errors.length > 1 ? 's' : ''
					})\n\n${compiler.errors
						.map(
							(error) =>
								`Error at line ${error.position[0] + 1}, column ${
									error.position[1] + 1
								}: ${error.message}\n\n`,
						)
						.join('')}`

					vscode.window.showErrorMessage(compilerErrorMessage);
				}

				if (compiler.bytes.length === 0) {
					vscode.window.showErrorMessage('Code empty');
				}

			} catch (error) {
				vscode.window.showErrorMessage(`Unexpected error: ${error.message}`);
			}

			const compiledCode = compiler.bytes;
			const panel = vscode.window.createWebviewPanel(
				'hexDump',
				`hex dump of ${path.basename(sourceCodePath)}`,
				vscode.ViewColumn.Two,
				{
					enableScripts: true,
				},
			);
			const theme = vscode.workspace.getConfiguration().get('workbench.colorTheme');

			panel.webview.html = webview(generateHexDump(compiledCode))
      panel.webview.postMessage({ command: 'setTheme', theme: theme });
		},
	);

	context.subscriptions.push(disposable);
}

function generateHexDump(compiledCode) {
    const bytesPerLine = 16;
    let hexDumpContent = '';

    for (let i = 0; i < compiledCode.length; i += bytesPerLine) {
        const bytes = compiledCode.slice(i, i + bytesPerLine);
        const hexLine = bytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
				// ASCII encode
        // const textLine = String.fromCharCode(...bytes).replace(/[\x00-\x1F\x7F-\xFF]/g, '.');

        hexDumpContent += `
            <tr>
                <th>${i.toString(16)[0].toUpperCase()}X</th>
                <td style="font-family: 'Consolas', 'Courier New', Courier, monospace;">${hexLine.padEnd(3 * bytesPerLine).toUpperCase()}</td>
            </tr>`;
    }

    return `
				<script>
					window.addEventListener('message', event => {
						const message = event.data;

						if (message.command === 'setTheme') {
								const theme = message.theme;
								const hexCodes = Array.from(document.querySelectorAll('code'))
								for hexCode in hexCodes:
									hexCode.style.background = theme.textCodeBlock.background
						}
					});
				</script>
        <table style="font-size: 1.5em;">
            <tbody>
							<tr>
								<td></td>
								<th style="text-align:justify; text-align-last:justify;">X0 X1 X2 X3 X4 X5 X6 X7 X8 X9 XA XB XC XD XE XF</th>
							</tr>
              ${hexDumpContent}
            </tbody>
        </table>`;
}

function webview(content) {
	return `
			<!DOCTYPE html>
			<html>
			<body>
					${content}
			</body>
			</html>
	`;
}

function deactivate() {}

module.exports = {
	activate,
	deactivate,
}
