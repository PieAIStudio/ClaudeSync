# ClaudeSync

[中文](README.zh-CN.md) · [English](README.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)

ClaudeSync muestra y organiza listas locales de sesiones de Claude Code entre cuentas del mismo ordenador. Gratuito, pensado primero para uso propio. TypeScript + React + Electron, con SwimmerUIKit y SwimmerI18nKit. v2 es una versión local de prueba sin publicar; v1 permanece en [GitHub Releases](https://github.com/PieAIStudio/ClaudeSync/releases).

## Uso

1. Abre `ClaudeSync.app` o el lanzador del código fuente. Actualiza.
2. Marca las cuentas que quieras incluir. Pulsa una cuenta para ver sus sesiones, o consulta la lista combinada sin duplicados.

Para conservar las mismas diez sesiones en todas las cuentas, elige esas diez y **Conservar solo las elegidas**. Se añaden donde faltan, se desarchivan las elegidas y se archivan las demás. Si falta alguna conversación o un destino está bloqueado, se detiene antes de archivar otras sesiones. **Elegir 10 recientes sincronizables** solo cambia la selección.

Las tareas remotas o programadas activas también bloquean esta operación. Gestiona primero esas tareas en Claude y después organiza las sesiones locales.

## Borrado y conteo

**Borrar sesiones elegidas** borra conversaciones, no cuentas. Abre una confirmación breve con consejo según su estado: archivar una sesión activa o cancelar para conservar una ya archivada. No hay copia de eliminación ni deshacer. El borrado local también quita copias antiguas configuradas de la misma cuenta y el JSONL principal si ninguna otra sesión lo usa. Conserva contenido compartido, proyectos, worktrees y archivos auxiliares de CLI. Otras operaciones mantienen revisión, copias y recuperación protegida.

Las cuentas verificadas usan la organización confirmada por el perfil; copias antiguas no cambian el estado actual de archivo. Correo y organización se guardan solo en el equipo. Las verificaciones local y de nube recuerdan la organización. Los registros antiguos con solo correo necesitan una nueva comprobación mientras esa cuenta está conectada para confirmar su organización. Local y nube tienen cifras y selecciones separadas. La nube muestra historial Code de la cuenta actual, incluido Wakeup, hasta 100 registros. Usa autorización existente sin caducar. Solo borra registros Remote Control verificados e inactivos; registros en ejecución, vinculados o desconocidos quedan bloqueados. Comprueba antes de escribir, para al primer fallo y verifica por lectura. No renueva OAuth, registra dispositivos, cambia horarios ni reintenta automáticamente. Cierra Claude para cambios locales; no para la nube. Credenciales solo en memoria del proceso principal. Lecturas reales verificadas; no se borraron conversaciones reales en la aceptación.

## Desarrollo

Usa Node 24 y la versión fijada de pnpm. En un checkout nuevo: `pnpm install --frozen-lockfile`.

```sh
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm package:mac:dir
```

Las pruebas usan datos sintéticos temporales. El modo de desarrollo permite aislarlos con `CLAUDESYNC_DATA_DIR`; los paquetes finales ignoran ese ajuste.

El paquete local es una `.app` Apple silicon sin firma. Windows, Intel Mac, Linux, firma y notarización necesitan validación aparte. Cinco idiomas, sin anuncios, seguimiento, pagos ni sincronización automática. CI solo manual; subir código no publica. El antiguo código Python/Tk/Web se retiró del código actual, conservando historial Git y versiones anteriores.

[Arquitectura](ARCHITECTURE.md) · [Contribuir](CONTRIBUTING.md) · [Seguridad](SECURITY.md) · [Plan](docs/PLAN-TS-CROSSPLATFORM-COMMERCIAL.md)
