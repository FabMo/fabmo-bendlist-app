UNIT_MAP = {
	'inch' : 'in',
	'inches' : 'in',
	'in' : 'in',
	'millimeter' : 'mm',
	'millimeters' : 'mm',
	'mm' : 'mm'
}

var BendCompiler = function(options) {
	this.setOptions(options);
}

BendCompiler.prototype.setOptions = function(options) {
	options = options || {};
	this.FeedFeedrate = options.FeedFeedrate || this.FeedFeedrate || 360;
	this.BendFeedrate = options.BendFeedrate || this.BendFeedrate || 6000;
	this.PositiveBendClearance = options.PositiveBendClearance || this.PositiveBendClearance || -82;
	this.NegativeBendClearance = options.NegativeBendClearance || this.NegativeBendClearance || -122;
}

BendCompiler.prototype.compile = function(text) {
	program = this._parse(text);
	expanded_program = this._expand(program);
	gcode = this._generateGCode(expanded_program);
	return gcode.join('\n');
}

/**
 * Takes raw text, and produces a parsed program.
 * A parsed program is a list of entry objects that have a `cmd` attribute
 * as well as other attributes (that vary by command)
 * 
 * An example program might be:
 * UNIT INCH
 * REPEAT 4:
 *   FEED 1
 *   BEND 90
 * END
 *
 * Which would produce:
 * {cmd:'unit', arg:'inch'}
 * {cmd:'repeat', arg:'inch'}
 * {cmd:'feed', arg:'1'}
 * {cmd:'bend', arg:'90'}
 * {cmd: 'end'}
 *
 * This function will throw an error if there is a problem parsing the file.
 */
BendCompiler.prototype._parse = function(text) {
	lines = text.split("\n");
	program = []
	for(i in lines) {
		var line = lines[i].trim().toLowerCase();
		var bend = line.match(/bend\s+(-?\d+(?:\.\d+)?)/);
		var feed = line.match(/feed\s+(-?\d+(?:\.\d+)?)/);
		var unit = line.match(/unit\s+((?:inch|inches|mm|millimeter))/)
		var repeat = line.match(/repeat\s+(\d+)\:/)
		var end = line.match(/end/)
		var comment = line.match(/\/\/|'/)
		if(bend) {
			program.push({cmd:'bend', arg:parseFloat(bend[1])});
		} else if(feed) {
			program.push({cmd:'feed', arg:parseFloat(feed[1])});
		} else if(unit) {
			program.push({cmd:'unit', arg:UNIT_MAP[unit[1]]});		
		} else if(repeat) {
			program.push({cmd:'repeat', arg:parseInt(repeat[1])});
		} else if(end) {
			program.push({cmd:'end'});
		} else if(comment) {
			program.push({cmd:'comment'})
		} else if (line === '') {
			program.push({cmd:'comment'})
		} else {
			throw new Error("Syntax Error on line " + i)
		}
	}
	return program;
}

/**
 * Takes a parsed program that may (or may not) contain "repeat" type commands, and expands
 * those repeats for the appropriate number of repetitions, removing the repeat commands from returned output.
 *
 * So passing something like this:
 * {cmd : 'repeat', arg : 4}
 * {cmd : 'feed', arg : 1}
 * {cmd : 'bend', arg : 90}
 * {cmd : 'end'}
 * 
 * Produces this:
 * {cmd : 'feed', arg : 1}
 * {cmd : 'bend', arg : 90}
 * {cmd : 'feed', arg : 1}
 * {cmd : 'bend', arg : 90}
 * {cmd : 'feed', arg : 1}
 * {cmd : 'bend', arg : 90}
 * {cmd : 'feed', arg : 1}
 * {cmd : 'bend', arg : 90}
 *
 * This function will throw an error if there is a mismatch between REPEAT and END statements.
 */
BendCompiler.prototype._expand = function(pgm) {
	repeat_stack = []
	pgm_output = []
	pc = 0;
	while(1) {
		if(pc >= pgm.length) {break;}
		line = pgm[pc]
		if(line.cmd === 'repeat') {
			repeat_stack.push([pc, line.arg]);
		} else if(line.cmd === 'end') {
			if(repeat_stack.length > 0) {
				line = repeat_stack[0][0];
				count = repeat_stack[0][1];
				console.log(count)
				if(count > 0) {
					pc = line;
					repeat_stack[0][1]--;
				} else {
					repeat_stack.pop();
				}
			} else {
				throw new Error("END without REPEAT at line " + pc);
			}
		} else {
			pgm_output.push(line)
		}
		pc += 1;
	}
		if(repeat_stack.length > 0) {
			throw new Error("REPEAT without END at line " + repeat_stack[repeat_stack.length-1][0]);
		}
	return pgm_output
}

/** Duck the bend pin */
BendCompiler.prototype._duck = function(force) {
	if(!this.ducked || force) {
		return ['(Duck)', 'G0Z180']
	}
	this.ducked = true;
}

/** Unduck the bend pin */
BendCompiler.prototype._unduck = function(force) {
	if(this.ducked || force) {
		return ['(Unduck)', 'G0Z0']
	}
	this.ducked = false;
}

/** Feed the wire.  Get the bend pin out of the way first. */
BendCompiler.prototype._feed = function(length) {
	retval = ['(Feed ' + length.toFixed(3) + ')']
	if(this.current_angle <= 0) {
		retval.push('G0X' + this.NegativeBendClearance.toFixed(5))		
	} else {
		retval.push('G0X' + this.PositiveBendClearance.toFixed(5))		
	}
	retval.push('G91');
	retval.push('G1Y' + length.toFixed(5) + 'F' + this.FeedFeedrate.toFixed(3));
	retval.push('G90');
	return retval;
}

/** Bend the wire.  Duck and switch sides if needed */
BendCompiler.prototype._bend = function(angle) {
	var retval = []
	if(this.current_angle <= 0) {
		if(angle <= 0) {
			retval = ['(Bend ' + angle + ' degrees)','G1X' + angle.toFixed(5) + 'F' + this.BendFeedrate.toFixed(2)]
		} else {
			retval.push.apply(retval, this._duck());
			retval.push('(Clear wire on positive side)');
			retval.push('G0X' + this.PositiveBendClearance.toFixed(5));
			retval.push.apply(retval, this._unduck())
			retval.push('G1X' + angle.toFixed(5) + 'F' + this.BendFeedrate.toFixed(3))
		}
	} else {
		if(angle > 0) {
			retval = ['(Bend ' + angle + ' degrees)','G1X' + angle.toFixed(5) + 'F' + this.BendFeedrate.toFixed(2)]
		} else {
			retval.push.apply(retval, this._duck());
			retval.push('(Clear wire on negative side)');
			retval.push('G0X' + this.NegativeBendClearance.toFixed(5))
			retval.push.apply(retval, this._unduck())
			retval.push('G1X' + angle.toFixed(5) + 'F' + this.BendFeedrate.toFixed(3))
		}
	}
	this.current_angle = angle;
	return retval
}

/** Change unit system */
BendCompiler.prototype._unit = function(unit) {
	switch(unit) {
		case 'in':
			return ['(Change units to inches)', 'G20'];
			break;
		case 'mm':
			return ['(Change units to millimeters)', 'G21'];
			break;
		default:
			return ['(Warning: unknown unit change? "' + unit + '")'];
			break;
	}
}

BendCompiler.prototype._init = function() {
 	var retval = ['(Bend Program)','(Generated by BendCompiler in javascript)','','(Absolute Mode)','G90',''];
 	this.current_angle = 0;
 	this.ducked = false;
 	return retval;
}

BendCompiler.prototype._exit = function() {
	return []; 
}


/** Turn an expanded program (only feeds, bends and unit changes) into a g-code program */
BendCompiler.prototype._generateGCode = function(pgm) {
	var retval = this._init();
	for(i in pgm) {
		line = pgm[i];
		switch(line.cmd) {
			case 'feed':
				var cmds = this._feed(line.arg);
				break;

			case 'bend':
				var cmds = this._bend(line.arg);
				break;

			case 'unit':
				var cmds = this._unit(line.arg);
				break;
		}
		retval.push.apply(retval, cmds);
		retval.push('')
	}
	retval.push.apply(retval, this._exit());

	return retval;
}