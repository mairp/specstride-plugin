# Licence notice for the as-is input streams of prime

The ten `*.jsonl` files in this directory are oracle assets of the Specstride
baseline, read from the Specstride baseline tree at commit `9cab15d`
(`lib/fixtures/prime-v3/`). They are copied byte for byte, unchanged; the
SHA-256 of every copied file is recorded in the phase evidence of task T003.
This file is the only file added here besides the streams.

They carry the licence of the Specstride baseline, which is distributed under
the Apache License, Version 2.0. The notice of the baseline:

> Copyright the Specstride baseline authors
>
> Licensed under the Apache License, Version 2.0 (the "License"); you may not
> use these files except in compliance with the License. You may obtain a copy
> of the License at
>
> http://www.apache.org/licenses/LICENSE-2.0
>
> Unless required by applicable law or agreed to in writing, software
> distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
> WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
> License for the specific language governing permissions and limitations under
> the License.

These are oracle assets: they are test inputs of the conformance and replay
suites and are never published as part of a distribution of this product. No
live output, credential, real session identifier or host name is contained in
them; the sanitization rules that the baseline states for them hold here too
(see the baseline's `lib/fixtures/prime-v3/README.md`, read at `9cab15d`).
