<p align="center">
  <img width="100" height="100" src="https://github.com/ents-crew/uems-venues-tartarus/blob/master/venues.png?raw=true">
  <br>
  <a href="https://coveralls.io/github/ents-crew/uems-venues-tartarus?branch=master">
    <img src="https://coveralls.io/repos/github/ents-crew/uems-venues-tartarus/badge.svg?branch=master" alt="Coverage Status"/>
  </a>
</p>

# uems-venues-tartarus

## Logging Notation

This module uses winston for logging with optional label support. Please use labels where possible. The following options are shown below:

```typescript
// Using the default logger without labels
//   + short
//   + easy
//   - makes logs ambiguous
//   - makes details in the logging platform vague (when that comes about)

import { __ } from "./logging/Log";
__.info('Hello');

// Using the long format with label
//   + descriptive
//   + adds labels
//   - long

import makeLogger from "./logging/Log";
const __ = makeLogger('hi');
__.info('hi');

// Using the shorthand function with labels

//   + descriptive
//   + adds labels
//   - skill kinda long

import { _ml } from "./logging/Log";
const ml = _ml('label');
ml.info('hey');
```

## Problems to Address
* Could abstract out the RabbitNetworkHandler and make it so you attach validators instead of it being opinionated about messages
* Handle an automatic timeout on requests, so we don't keep caching them if the handlers don't function properly
