# token-monitor

Mod de Claude Code que muestra, en tiempo real y sobre el prompt, el consumo de tokens y el llenado de la ventana de contexto:

```
[Contexto: ~45% | Tokens: 12.4k in / 1.8k out]
```

- **< 70 %**: texto atenuado (normal).
- **70–79 %**: amarillo (`warning`).
- **≥ 80 %**: rojo en negrita con `⚠` (`error`).

Además añade el comando local **`/tokens`**, que imprime un desglose (entrada sin caché / escrita en caché / leída de caché, salida, peticiones, modelo, contexto y coste) **sin llamar al modelo**.

## Estructura

```
.claude-plugin/plugin.json       manifiesto del plugin
.claude-plugin/marketplace.json  hace del repo un marketplace instalable
hooks/hooks.json                 apunta al módulo de hooks
hooks/register.tsx               el Mod
types/index.d.ts                 contrato de tipos del estado ($.state)
tests/token-monitor.test.tsx     tests (claude plugin test .)
```

## Cómo funciona

| Hook | Qué hace |
| --- | --- |
| `session.start` | registra `/tokens` y lee `$.session.usage()` para sembrar el contexto |
| `turn.step` | tras cada petición al modelo (hilo principal y subagentes) suma su `usage` |
| `session.measure` | el motor empuja el llenado real del contexto (`tokens / window`) y el coste |
| `command.run` `{ command: 'tokens' }` | responde sin `next`: no se hace ninguna llamada a Claude |
| `ui.render` `{ component: 'AbovePrompt' }` | dibuja la banda sobre el prompt |

Los contadores viven en `$.state` (memoria de la sesión), así que una recarga en caliente no los pone a cero. `in` = entrada sin caché + escrita en caché + leída de caché (todo lo que el modelo leyó).

## Probarlo

Desde la raíz de este repo:

```bash
claude plugin validate .     # comprueba manifiesto, hooks y contrato de estado
claude plugin test .         # ejecuta los tests
claude --plugin-dir .        # arranca Claude Code con el mod cargado
```

Dentro de la sesión: envía cualquier prompt y verás la banda actualizarse; escribe `/tokens` para el desglose. Si editas `hooks/register.tsx` con la sesión abierta, ejecuta `/reload-plugins` para recargarlo sin reiniciar.

## Instalarlo

```
/plugin install token-monitor --marketplace aceleratalent/mod-monitor
```
