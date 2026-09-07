import { useEffect, useState } from "react";
import { getReachable, subscribeReachability } from "../api/client";

/** Whether the last request to the backend actually got a response. */
export function useServerReachable(): boolean {
  const [reachableState, setReachableState] = useState(getReachable());
  useEffect(() => subscribeReachability(setReachableState), []);
  return reachableState;
}
