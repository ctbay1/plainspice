| # | string | I source: v(n1)=I (42) | (47) | R: @r1[resistance] (42) | (47) | C: @c1[capacitance] (42) | (47) | messages (42 / 47, first lines) |
|---|---|---|---|---|---|---|---|---|
| 00 | `1M` | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 |  |
| 01 | `1m` | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 |  |
| 02 | `1meg` | 1000000 | 1000000 | 1000000 | 1000000 | 1000000 | 1000000 |  |
| 03 | `1MEG` | 1000000 | 1000000 | 1000000 | 1000000 | 1000000 | 1000000 |  |
| 04 | `1Meg` | 1000000 | 1000000 | 1000000 | 1000000 | 1000000 | 1000000 |  |
| 05 | `1mil` | 2.54e-05 | 2.54e-05 | 2.54e-05 | 2.54e-05 | 2.54e-05 | 2.54e-05 |  |
| 06 | `3A` | 3e-18 | 3e-18 | 3e-18 | 1e-12 | 3e-18 | 3e-18 | SR/47: Warning: Value of resistor r1 is too small, set to 1.000000e-12 |
| 07 | `3a` | 3e-18 | 3e-18 | 3e-18 | 1e-12 | 3e-18 | 3e-18 | SR/47: Warning: Value of resistor r1 is too small, set to 1.000000e-12 |
| 08 | `1F` | 1e-15 | 1e-15 | 1e-15 | 1e-12 | 1e-15 | 1e-15 | SR/47: Warning: Value of resistor r1 is too small, set to 1.000000e-12 |
| 09 | `1f` | 1e-15 | 1e-15 | 1e-15 | 1e-12 | 1e-15 | 1e-15 | SR/47: Warning: Value of resistor r1 is too small, set to 1.000000e-12 |
| 10 | `1u` | 1e-06 | 1e-06 | 1e-06 | 1e-06 | 1e-06 | 1e-06 |  |
| 11 | `1µ` | 1e-06 | 1e-06 | 1e-06 | 1e-06 | 1e-06 | 1e-06 |  |
| 12 | `10k` | 10000 | 10000 | 10000 | 10000 | 10000 | 10000 |  |
| 13 | `10K` | 10000 | 10000 | 10000 | 10000 | 10000 | 10000 |  |
| 14 | `1g` | 1000000000 | 1000000000 | 1000000000 | 1000000000 | 1000000000 | 1000000000 |  |
| 15 | `1t` | 1e+12 | 1e+12 | 1e+12 | 1e+12 | 1e+12 | 1e+12 |  |
| 16 | `1p` | 1e-12 | 1e-12 | 1e-12 | 1e-12 | 1e-12 | 1e-12 |  |
| 17 | `1n` | 1e-09 | 1e-09 | 1e-09 | 1e-09 | 1e-09 | 1e-09 |  |
| 18 | `2.2k` | 2200 | 2200 | 2200 | 2200 | 2200 | 2200 |  |
| 19 | `2k2` | 2000 | 2000 | 2000 | 2000 | 2000 | 2000 | SC/42: warning, can't find model '2k2' from line /     c1 n1 0 2k2<br>SC/47: warning, can't find model '2k2' from line /     c1 n1 0 2k2 |
| 20 | `10kOhm` | 10000 | 10000 | 10000 | 10000 | 10000 | 10000 | SC/42: warning, can't find model '10kohm' from line /     c1 n1 0 10kohm<br>SC/47: warning, can't find model '10kohm' from line /     c1 n1 0 10kohm |
| 21 | `10V` | 10 | 10 | 10 | 10 | 10 | 10 | SC/42: warning, can't find model '10v' from line /     c1 n1 0 10v<br>SC/47: warning, can't find model '10v' from line /     c1 n1 0 10v |
| 22 | `1e3` | 1000 | 1000 | 1000 | 1000 | 1000 | 1000 |  |
| 23 | `1E3` | 1000 | 1000 | 1000 | 1000 | 1000 | 1000 |  |
| 24 | `1 k` | ERROR (exit 1) | ERROR (exit 1) | ERROR (exit 1) | ERROR (exit 1) | ERROR (exit 1) | ERROR (exit 1) | SI/42: Error on line 2 or its substitute: /   i1 0 n1 1 k /   unknown parameter (k)<br>SI/47: Error on line 2 or its substitute: /   i1 0 n1 1 k /   unknown parameter (k)<br>SR/42: warning, can't find model 'k' from line /     r1 n1 0 1 k / Error on line 3 or its substitute:<br>SR/47: warning, can't find model 'k' from line /     r1 n1 0 1 k / Error on line 3 or its substitute:<br>SC/42: Error on line 3 or its substitute: /   c1 n1 0 1 k /   unknown parameter (k)<br>SC/47: Error on line 3 or its substitute: /   c1 n1 0 1 k /   unknown parameter (k) |
| 25 | `1.` | 1 | 1 | 1 | 1 | 1 | 1 |  |
| 26 | `.5` | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 |  |
| 27 | `1MOhm` | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | SC/42: warning, can't find model '1mohm' from line /     c1 n1 0 1mohm<br>SC/47: warning, can't find model '1mohm' from line /     c1 n1 0 1mohm |
| 28 | `1Mohm` | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | SC/42: warning, can't find model '1mohm' from line /     c1 n1 0 1mohm<br>SC/47: warning, can't find model '1mohm' from line /     c1 n1 0 1mohm |
| 29 | `4.7MΩ` | 0.0047 | 0.0047 | 0.0047 | 0.0047 | 0.0047 | 0.0047 | SC/42: warning, can't find model '4.7mΩ' from line /     c1 n1 0 4.7mΩ<br>SC/47: warning, can't find model '4.7mΩ' from line /     c1 n1 0 4.7mΩ |
| 30 | `1kΩ` | 1000 | 1000 | 1000 | 1000 | 1000 | 1000 | SC/42: warning, can't find model '1kΩ' from line /     c1 n1 0 1kΩ<br>SC/47: warning, can't find model '1kΩ' from line /     c1 n1 0 1kΩ |
| 31 | `1μ` | 1 | 1 | 1 | 1 | 1 | 1 | SC/42: warning, can't find model '1μ' from line /     c1 n1 0 1μ<br>SC/47: warning, can't find model '1μ' from line /     c1 n1 0 1μ |
| 32 | `1G` | 1000000000 | 1000000000 | 1000000000 | 1000000000 | 1000000000 | 1000000000 |  |
| 33 | `1T` | 1e+12 | 1e+12 | 1e+12 | 1e+12 | 1e+12 | 1e+12 |  |
| 34 | `1mA` | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | SC/42: warning, can't find model '1ma' from line /     c1 n1 0 1ma<br>SC/47: warning, can't find model '1ma' from line /     c1 n1 0 1ma |
| 35 | `100mV` | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | 0.1 | SC/42: warning, can't find model '100mv' from line /     c1 n1 0 100mv<br>SC/47: warning, can't find model '100mv' from line /     c1 n1 0 100mv |
| 36 | `1e3k` | 1000000 | 1000000 | 1000000 | 1000000 | 1000000 | 1000000 |  |
| 37 | `-2` | -2 | -2 | -2 | -2 | -2 | -2 |  |
| 38 | `+3` | 3 | 3 | 3 | 3 | 3 | 3 |  |
| 39 | `5 V` | ERROR (exit 1) | ERROR (exit 1) | ERROR (exit 1) | ERROR (exit 1) | ERROR (exit 1) | ERROR (exit 1) | SI/42: Error on line 2 or its substitute: /   i1 0 n1 5 v / no such parameter on this device<br>SI/47: Error on line 2 or its substitute: /   i1 0 n1 5 v / no such parameter on this device or parameter is missing<br>SR/42: warning, can't find model 'v' from line /     r1 n1 0 5 v / Error on line 3 or its substitute:<br>SR/47: warning, can't find model 'v' from line /     r1 n1 0 5 v / Error on line 3 or its substitute:<br>SC/42: Error on line 3 or its substitute: /   c1 n1 0 5 v /   unknown parameter (v)<br>SC/47: Error on line 3 or its substitute: /   c1 n1 0 5 v /   unknown parameter (v) |
| 40 | `1x` | 1 | 1 | 1 | 1 | 1 | 1 | SC/42: warning, can't find model '1x' from line /     c1 n1 0 1x<br>SC/47: warning, can't find model '1x' from line /     c1 n1 0 1x |
| 41 | `4k7` | 4000 | 4000 | 4000 | 4000 | 4000 | 4000 | SC/42: warning, can't find model '4k7' from line /     c1 n1 0 4k7<br>SC/47: warning, can't find model '4k7' from line /     c1 n1 0 4k7 |
| 42 | `0.5` | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 |  |
| 43 | `1e-3` | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 |  |
| 44 | `1d3` | 1000 | 1000 | 1000 | 1000 | 1000 | 1000 | SC/42: warning, can't find model '1d3' from line /     c1 n1 0 1d3<br>SC/47: warning, can't find model '1d3' from line /     c1 n1 0 1d3 |
| 45 | `1meg5` | 1000000 | 1000000 | 1000000 | 1000000 | 1000000 | 1000000 | SC/42: warning, can't find model '1meg5' from line /     c1 n1 0 1meg5<br>SC/47: warning, can't find model '1meg5' from line /     c1 n1 0 1meg5 |
| 46 | `1.5.2` | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | 1.5 | SC/42: warning, can't find model '1.5.2' from line /     c1 n1 0 1.5.2<br>SC/47: warning, can't find model '1.5.2' from line /     c1 n1 0 1.5.2 |
| 47 | `1_000` | 1 | 1 | 1 | 1 | 1 | 1 | SC/42: warning, can't find model '1_000' from line /     c1 n1 0 1_000<br>SC/47: warning, can't find model '1_000' from line /     c1 n1 0 1_000 |
