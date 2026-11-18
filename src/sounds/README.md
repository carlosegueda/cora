# Sonidos

Un archivo de audio aquí sustituye al sonido sintetizado del mismo nombre (`.mp3`, `.ogg` o `.wav`):

| Archivo   | Cuándo suena                   |
| --------- | ------------------------------ |
| `click`   | Botones y pestañas             |
| `correct` | Acierto                        |
| `wrong`   | Fallo                          |
| `tick`    | Cuenta atrás (3, 2, 1)         |
| `go`      | ¡Ya!                           |
| `timeout` | Se acabó el tiempo             |
| `finish`  | Fin de la partida              |

Si falta alguno, se usa el sonido generado por código (`src/sound.js`).
`.mp3` o `.wav` funcionan en todos los navegadores; `.ogg` no en Safari antiguo.
