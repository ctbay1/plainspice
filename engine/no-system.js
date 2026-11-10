/**
 * Linked into the engine with --js-library (engine/build.sh): ngspice's shell, gnuplot and edit
 * commands call system(). In a browser Emscripten already refuses, but under Node its default
 * runs the command in a shell on the host, so a netlist with ".control" and "shell ..." would run
 * commands on the machine running the tests or scripts. A netlist is data, so the engine refuses
 * everywhere, exactly as Emscripten's browser branch does (system.c turns -ENOSYS into errno).
 */
addToLibrary({
  _emscripten_system: (command) => {
    if (!command) return 0; // no shell available
    return -{{{ cDefs.ENOSYS }}};
  },
});
