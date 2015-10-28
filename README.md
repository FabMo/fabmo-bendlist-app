# Fabmo Bend List App

## About
This project converts a "bend list" to a job and submits it to the tool.  It is meant to run on a DIWire

## Example bend list
```
UNIT INCH
REPEAT 4:
   FEED 1
   BEND 90
   END
```

The above bendlist bends a square.

## Gotchas
 * Currently, the bend generated by the BEND statement is just the angle - there is no springback compensation.  This is _guaranteed not to work_ not just because of springback, but because of the fact that a 90 degree bend in the wire doesn't simply correspond to a position of 90 on the bend pin.  There needs to be an offset both for positive and negative bends.
 * Comments don't work properly, don't try them.
 * Duck and unduck move to 180 and 0 degrees respectively on the Z axis.  You need to manually zero the tool in the "unducked" position
 * Feeds/speeds are passed into the BendCompiler, the defaults are in inches.  You need to change them if you use millimeters.
 * Every repeat statement must have an END
